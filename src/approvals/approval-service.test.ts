import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openDatabase, type DB } from '../db/database.js';
import { createService } from '../db/repositories/services.js';
import { upsertSession } from '../db/repositories/sessions.js';
import { createQuote, getQuote, listQuoteItems, updateQuotePricing } from '../db/repositories/quotes.js';
import { listNotifications, unreadNotificationCount } from '../db/repositories/notifications.js';
import { listLogs } from '../db/repositories/logs.js';
import { ApprovalService, toSqlTimestamp } from './approval-service.js';
import { approvedQuoteMessage, rejectedQuoteMessage } from './messages.js';

const databases: DB[] = [];
afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

interface Fixture {
  db: DB;
  service: ApprovalService;
  serviceId: number;
  adminId: number;
  clock: { now: Date };
}

function setup(): Fixture {
  const db = openDatabase(':memory:');
  databases.push(db);
  const clock = { now: new Date('2026-11-11T10:00:00.000Z') };
  const service = new ApprovalService(db, { windowHours: 6, now: () => clock.now });
  const created = createService(db, {
    name: 'Workflow Automation',
    description: '',
    category: 'workflow',
    status: 'available',
    availability_note: '',
  });
  const admin = db
    .prepare("INSERT INTO admin_users (username, password_hash) VALUES ('test-admin', 'unused')")
    .run();
  return { db, service, serviceId: created.id, adminId: Number(admin.lastInsertRowid), clock };
}

function makeQuote(fixture: Fixture, sessionId: string, externalUserId = 'customer-1') {
  upsertSession(fixture.db, { id: sessionId, channel: 'telegram', external_user_id: externalUserId, context: {} });
  return createQuote(fixture.db, {
    sessionId,
    channel: 'telegram',
    externalUserId,
    intakeId: null,
    serviceId: fixture.serviceId,
    serviceName: 'Workflow Automation',
    marginPercent: 30,
    notes: '',
    items: [
      {
        priceItemId: null,
        itemCode: 'WF-1',
        description: 'Discovery workshop',
        unit: 'day',
        quantity: 1,
        adminUnitPricePaise: 100_000,
        quotedUnitPricePaise: 130_000,
        lineTotalPaise: 130_000,
      },
    ],
  });
}

describe('ApprovalService', () => {
  it('formats SQLite-compatible UTC timestamps', () => {
    assert.equal(toSqlTimestamp(new Date('2026-11-11T10:05:09.999Z')), '2026-11-11 10:05:09');
  });

  it('submits a draft with a six-hour window and an unread admin alert', () => {
    const fixture = setup();
    const quote = makeQuote(fixture, 'sess-1');

    const submitted = fixture.service.submit(quote.id);
    assert.equal(submitted.status, 'pending_approval');
    assert.equal(submitted.expires_at, '2026-11-11 16:00:00');
    assert.equal(submitted.next_alert_at, '2026-11-11 16:00:00');
    assert.equal(submitted.alert_count, 0);

    const notifications = listNotifications(fixture.db);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].kind, 'quote_approval');
    assert.match(notifications[0].title, /needs approval/);
    assert.equal(unreadNotificationCount(fixture.db), 1);
    assert.ok(listLogs(fixture.db).some((log) => log.event === 'quote.pending_approval'));
  });

  it('is not due until the window lapses and then re-alerts admins', () => {
    const fixture = setup();
    const quote = makeQuote(fixture, 'sess-2');
    fixture.service.submit(quote.id);
    assert.deepEqual(fixture.service.due(), []);

    fixture.clock.now = new Date('2026-11-11T16:00:01.000Z');
    const due = fixture.service.due();
    assert.deepEqual(due.map((entry) => entry.id), [quote.id]);

    const { quote: reminded, notification } = fixture.service.reAlert(quote.id);
    assert.equal(reminded.alert_count, 1);
    assert.equal(reminded.next_alert_at, '2026-11-11 22:00:01');
    assert.equal(notification.kind, 'quote_realert');
    assert.match(notification.title, /Reminder/);
    assert.equal(unreadNotificationCount(fixture.db), 2);
    assert.deepEqual(fixture.service.due(), []);
  });

  it('records an approval decision and clears the alerts', () => {
    const fixture = setup();
    const quote = makeQuote(fixture, 'sess-3');
    fixture.service.submit(quote.id);
    fixture.clock.now = new Date('2026-11-11T12:00:00.000Z');

    const decided = fixture.service.decide(quote.id, 'approved', fixture.adminId, '');
    assert.equal(decided.status, 'approved');
    assert.equal(decided.decided_by, fixture.adminId);
    assert.equal(decided.approved_by, fixture.adminId);
    assert.equal(decided.approved_at, '2026-11-11 12:00:00');
    assert.equal(decided.next_alert_at, null);
    assert.equal(unreadNotificationCount(fixture.db), 0);
    assert.ok(listLogs(fixture.db).some((log) => log.event === 'quote.approved'));
    assert.throws(() => fixture.service.decide(quote.id, 'approved', fixture.adminId), /awaiting approval/);
  });

  it('keeps a rejection note and clears the alerts', () => {
    const fixture = setup();
    const quote = makeQuote(fixture, 'sess-4');
    fixture.service.submit(quote.id);
    const decided = fixture.service.decide(quote.id, 'rejected', fixture.adminId, 'Budget too small.');
    assert.equal(decided.status, 'rejected');
    assert.equal(decided.decision_note, 'Budget too small.');
    assert.equal(decided.approved_at, null);
    assert.equal(unreadNotificationCount(fixture.db), 0);
    assert.ok(listLogs(fixture.db).some((log) => log.event === 'quote.rejected'));
  });

  it('supersedes an older pending quote for the same session', () => {
    const fixture = setup();
    const first = makeQuote(fixture, 'sess-5');
    const second = makeQuote(fixture, 'sess-5');
    fixture.service.submit(first.id);
    fixture.service.submit(second.id);

    assert.equal(getQuote(fixture.db, first.id)?.status, 'superseded');
    assert.equal(getQuote(fixture.db, second.id)?.status, 'pending_approval');
    assert.equal(fixture.service.listPending().length, 1);
    const unread = listNotifications(fixture.db, { unreadOnly: true });
    assert.deepEqual(unread.map((entry) => entry.quote_id), [second.id]);
  });

  it('recomputes admin edits to quantities and margin while keeping admin prices locked', () => {
    const fixture = setup();
    const quote = makeQuote(fixture, 'sess-6');
    fixture.service.submit(quote.id);
    const item = listQuoteItems(fixture.db, quote.id)[0];

    const updated = updateQuotePricing(fixture.db, quote.id, {
      marginPercent: 35,
      quantities: { [item.id]: 2 },
    });
    const updatedItem = listQuoteItems(fixture.db, quote.id)[0];
    assert.equal(updated.margin_percent, 35);
    assert.equal(updatedItem.quantity, 2);
    assert.equal(updatedItem.admin_unit_price_paise, 100_000);
    assert.equal(updatedItem.quoted_unit_price_paise, 135_000);
    assert.equal(updatedItem.line_total_paise, 270_000);
    assert.equal(updated.subtotal_paise, 200_000);
    assert.equal(updated.total_paise, 270_000);
    assert.equal(updated.margin_paise, 70_000);

    assert.throws(
      () => updateQuotePricing(fixture.db, quote.id, { marginPercent: 36 }),
      /between 30 and 35/,
    );
    assert.throws(
      () => updateQuotePricing(fixture.db, quote.id, { marginPercent: 30, quantities: { 9999: 1 } }),
      /not found/,
    );
    assert.throws(
      () => updateQuotePricing(fixture.db, quote.id, { marginPercent: 30, quantities: { [item.id]: 0 } }),
      /greater than zero/,
    );
  });
});

describe('customer approval messages', () => {
  it('itemizes an approved quote with INR line totals', () => {
    const fixture = setup();
    const quote = makeQuote(fixture, 'sess-7');
    const message = approvedQuoteMessage(quote, listQuoteItems(fixture.db, quote.id));
    assert.match(message, /WF-1/);
    assert.match(message, /Discovery workshop/);
    assert.match(message, /1 day × ₹1,300\.00 = ₹1,300\.00/);
    assert.match(message, /Total: ₹1,300\.00 \(INR\)/);
    assert.match(message, new RegExp(quote.quote_number));
  });

  it('sends a price-free handoff when a quote is rejected', () => {
    const fixture = setup();
    const quote = makeQuote(fixture, 'sess-8');
    const message = rejectedQuoteMessage(quote);
    assert.equal(message.includes('₹'), false);
    assert.match(message, /specialist will follow up/i);
    assert.match(message, /Workflow Automation/);
  });
});
