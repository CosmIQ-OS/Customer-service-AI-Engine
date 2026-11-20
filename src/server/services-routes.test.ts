import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { AdminAuth } from '../auth/admin-auth.js';
import { openDatabase, type DB } from '../db/database.js';
import { publishPriceTable } from '../db/repositories/pricing.js';
import type { ServiceRecord } from '../engine/types.js';
import { SupportEngine } from '../engine/support-engine.js';
import { MockLLMProvider } from '../llm/mock.js';
import { createApp } from './app.js';

const PASSWORD = 'a-long-test-password';

describe('services API', () => {
  let db: DB;
  let engine: SupportEngine;
  let server: Server;
  let base: string;
  let cookie: string;

  before(async () => {
    db = await openDatabase(':memory:');
    const auth = new AdminAuth(db, { sessionHours: 1 });
    await auth.createAdmin('owner', PASSWORD);
    engine = new SupportEngine(db, {
      sessionTtlMinutes: 120,
      llm: new MockLLMProvider(),
      model: 'mock',
      maxSteps: 6,
      maxHistory: 12,
      temperature: 0,
      tenantId: 'test',
    });

    const app = createApp(engine, {
      auth,
      sessionHours: 1,
      cookieSecure: false,
      webhookSecret: 'webhook-secret-0123456789',
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: PASSWORD }),
    });
    cookie = /cosmiq_admin=[^;]+/.exec(res.headers.get('set-cookie') ?? '')?.[0] ?? '';
    assert.ok(cookie, 'login should set the session cookie');
  });

  after(async () => {
    server.closeAllConnections();
    server.close();
    await db.close();
  });

  it('requires admin authentication for POST, PATCH, and DELETE /api/services', async () => {
    assert.equal(
      (await fetch(`${base}/api/services`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Unauth Service' }),
      })).status,
      401,
    );
    assert.equal(
      (await fetch(`${base}/api/services/1`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'maintenance' }),
      })).status,
      401,
    );
    assert.equal((await fetch(`${base}/api/services/1`, { method: 'DELETE' })).status, 401);
  });

  it('creates services with defaults, paise, basePriceInr conversion, and precedence', async () => {
    const defaultRes = await fetch(`${base}/api/services`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Default Price Service' }),
    });
    assert.equal(defaultRes.status, 201);
    const defaultSvc = (await defaultRes.json()) as ServiceRecord;
    assert.equal(defaultSvc.status, 'available');
    assert.equal(defaultSvc.description, '');
    assert.equal(defaultSvc.category, 'general');
    assert.equal(defaultSvc.base_price_paise, 0);
    assert.equal(typeof defaultSvc.base_price_paise, 'number');

    const inrRes = await fetch(`${base}/api/services`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'INR Service',
        category: 'automation',
        description: 'Built from INR',
        status: 'limited',
        availability_note: '2 slots/month',
        basePriceInr: 1499.5,
      }),
    });
    assert.equal(inrRes.status, 201);
    const inrSvc = (await inrRes.json()) as ServiceRecord;
    assert.equal(inrSvc.base_price_paise, 149_950);
    assert.equal(inrSvc.status, 'limited');

    const precedenceRes = await fetch(`${base}/api/services`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Precedence Service',
        base_price_paise: 5000,
        basePriceInr: 100,
      }),
    });
    assert.equal(precedenceRes.status, 201);
    const precedenceSvc = (await precedenceRes.json()) as ServiceRecord;
    assert.equal(precedenceSvc.base_price_paise, 5000);

    const listRes = await fetch(`${base}/api/services`, { headers: { cookie } });
    assert.equal(listRes.status, 200);
    const list = (await listRes.json()) as ServiceRecord[];
    assert.ok(list.some((s) => s.id === inrSvc.id && s.base_price_paise === 149_950));
  });

  it('rejects invalid payloads on POST /api/services with 400', async () => {
    for (const body of [
      { name: '   ' },
      { name: 'Bad Status', status: 'archived' },
      { name: 'Negative Paise', base_price_paise: -1 },
      { name: 'Float Paise', base_price_paise: 12.5 },
      { name: 'Negative INR', basePriceInr: -5 },
      { name: 'Valid Paise Invalid INR', base_price_paise: 5000, basePriceInr: -1 },
      { name: 'Non-numeric INR', basePriceInr: '1000' },
    ]) {
      const res = await fetch(`${base}/api/services`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    }
  });

  it('supports partial PATCH status toggles and price updates without overwriting omitted fields', async () => {
    const created = (await (await fetch(`${base}/api/services`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Toggle Service',
        description: 'Important description',
        category: 'ai',
        status: 'available',
        availability_note: 'Ready now',
        basePriceInr: 25_000,
      }),
    })).json()) as ServiceRecord;
    assert.equal(created.base_price_paise, 2_500_000);

    for (const nextStatus of ['maintenance', 'limited', 'unavailable', 'available'] as const) {
      const patchedRes = await fetch(`${base}/api/services/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ status: nextStatus }),
      });
      assert.equal(patchedRes.status, 200);
      const patched = (await patchedRes.json()) as ServiceRecord;
      assert.equal(patched.status, nextStatus);
      assert.equal(patched.name, 'Toggle Service');
      assert.equal(patched.description, 'Important description');
      assert.equal(patched.category, 'ai');
      assert.equal(patched.availability_note, 'Ready now');
      assert.equal(patched.base_price_paise, 2_500_000);
    }

    const pricePatch = await fetch(`${base}/api/services/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ basePriceInr: 32_000 }),
    });
    assert.equal(pricePatch.status, 200);
    const updated = (await pricePatch.json()) as ServiceRecord;
    assert.equal(updated.base_price_paise, 3_200_000);
    assert.equal(updated.description, 'Important description');
    assert.equal(updated.status, 'available');

    for (const badId of ['abc', '0', '-1', '1.5']) {
      const res = await fetch(`${base}/api/services/${badId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ status: 'maintenance' }),
      });
      assert.equal(res.status, 400);
    }
    assert.equal(
      (await fetch(`${base}/api/services/99999`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ status: 'maintenance' }),
      })).status,
      404,
    );
  });

  it('enforces id validation, 404, cascade/set-null cleanup, and 409 proposal safety check on DELETE', async () => {
    for (const badId of ['abc', '0', '-1', '1.5']) {
      assert.equal((await fetch(`${base}/api/services/${badId}`, { method: 'DELETE', headers: { cookie } })).status, 400);
    }
    assert.equal((await fetch(`${base}/api/services/99999`, { method: 'DELETE', headers: { cookie } })).status, 404);

    // 1. Unreferenced service (even with price_tables and service_intakes) deletes cleanly
    const deletable = (await (await fetch(`${base}/api/services`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Deletable Service', basePriceInr: 10_000 }),
    })).json()) as ServiceRecord;

    await publishPriceTable(db, {
      serviceId: deletable.id,
      sourceFilename: 'deletable.csv',
      uploadedBy: null,
      items: [{ item_code: 'DEL-1', description: 'Temp item', unit: 'project', unit_price_paise: 100_000 }],
    });
    await db.query("INSERT INTO sessions (id, channel, external_user_id) VALUES ('sess-del-1', 'web', 'user-del')");
    await db.query(
      "INSERT INTO service_intakes (session_id, channel, external_user_id, service_id, service_name) VALUES ('sess-del-1', 'web', 'user-del', $1, $2)",
      [deletable.id, deletable.name],
    );

    const delRes = await fetch(`${base}/api/services/${deletable.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    assert.equal(delRes.status, 200);
    assert.deepEqual(await delRes.json(), { deleted: true, id: deletable.id });

    const intakeAfter = await db.queryOne<{ service_id: number | null }>(
      "SELECT service_id FROM service_intakes WHERE session_id = 'sess-del-1'",
    );
    assert.equal(intakeAfter?.service_id, null);

    // 2. Service referenced by quotes.service_id returns 409 SERVICE_IN_USE
    const protectedSvc = (await (await fetch(`${base}/api/services`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Protected Proposal Service', basePriceInr: 50_000 }),
    })).json()) as ServiceRecord;

    await db.query(
      `INSERT INTO quotes (quote_number, channel, external_user_id, service_id, service_name, margin_percent)
       VALUES ('Q-DEL-1', 'web', 'user-1', $1, $2, 30)`,
      [protectedSvc.id, protectedSvc.name],
    );

    const blockedRes = await fetch(`${base}/api/services/${protectedSvc.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    assert.equal(blockedRes.status, 409);
    assert.deepEqual(await blockedRes.json(), {
      error: 'Cannot delete service referenced by existing proposals',
      code: 'SERVICE_IN_USE',
      quoteCount: 1,
    });
    assert.ok(await engine.getService(protectedSvc.id), 'protected service must still exist after 409');

    // 3. Forward compatibility with M3 quote_items.service_id column
    const itemLinkedSvc = (await (await fetch(`${base}/api/services`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Line Item Linked Service', basePriceInr: 20_000 }),
    })).json()) as ServiceRecord;

    await db.exec('ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS service_id INTEGER REFERENCES services(id) ON DELETE RESTRICT');
    const quoteRow = await db.queryOne<{ id: number }>("SELECT id FROM quotes WHERE quote_number = 'Q-DEL-1'");
    await db.query(
      `INSERT INTO quote_items (quote_id, service_id, item_code, description, unit, quantity, admin_unit_price_paise, quoted_unit_price_paise, line_total_paise, sort_order)
       VALUES ($1, $2, 'ITEM-1', 'Line item ref', 'project', 1, 2000000, 2000000, 2000000, 1)`,
      [quoteRow!.id, itemLinkedSvc.id],
    );

    const blockedItemRes = await fetch(`${base}/api/services/${itemLinkedSvc.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    assert.equal(blockedItemRes.status, 409);
    assert.deepEqual(await blockedItemRes.json(), {
      error: 'Cannot delete service referenced by existing proposals',
      code: 'SERVICE_IN_USE',
      quoteCount: 1,
    });
  });

  it('rejects out-of-range INT4 service ids on PATCH and DELETE with 400', async () => {
    for (const outOfRangeId of ['2147483648', '999999999999999']) {
      const patchRes = await fetch(`${base}/api/services/${outOfRangeId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ status: 'maintenance' }),
      });
      assert.equal(patchRes.status, 400, `PATCH ${outOfRangeId} should return 400`);
      assert.deepEqual(await patchRes.json(), { error: 'Invalid service id' });

      const deleteRes = await fetch(`${base}/api/services/${outOfRangeId}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      assert.equal(deleteRes.status, 400, `DELETE ${outOfRangeId} should return 400`);
      assert.deepEqual(await deleteRes.json(), { error: 'Invalid service id' });
    }

    assert.equal(
      (await fetch(`${base}/api/services/2147483647`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ status: 'maintenance' }),
      })).status,
      404,
    );
    assert.equal(
      (await fetch(`${base}/api/services/2147483647`, {
        method: 'DELETE',
        headers: { cookie },
      })).status,
      404,
    );
  });

  it('catches SQLSTATE 23001 (ON DELETE RESTRICT) FK violations as 409 SERVICE_IN_USE', async () => {
    const svcRes = await fetch(`${base}/api/services`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Restrict Guard Service', basePriceInr: 15_000 }),
    });
    assert.equal(svcRes.status, 201);
    const svc = (await svcRes.json()) as ServiceRecord;

    await db.exec(
      'CREATE TABLE IF NOT EXISTS _test_fk_restrict_guard (id SERIAL PRIMARY KEY, svc_id INTEGER NOT NULL REFERENCES services(id) ON DELETE RESTRICT)',
    );
    try {
      await db.query('INSERT INTO _test_fk_restrict_guard (svc_id) VALUES ($1)', [svc.id]);

      const delRes = await fetch(`${base}/api/services/${svc.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      assert.equal(delRes.status, 409);
      assert.deepEqual(await delRes.json(), {
        error: 'Cannot delete service referenced by existing proposals',
        code: 'SERVICE_IN_USE',
        quoteCount: 1,
      });
      assert.ok(await engine.getService(svc.id), 'service must still exist after 23001 guard');
    } finally {
      await db.exec('DROP TABLE IF EXISTS _test_fk_restrict_guard');
    }
  });
});
