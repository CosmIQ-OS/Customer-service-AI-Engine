import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { AdminAuth } from '../auth/admin-auth.js';
import { openDatabase, type DB } from '../db/database.js';
import {
  COMPANY_SIZE_MULTIPLIERS_KEY,
  DEFAULT_COMPANY_SIZE_MULTIPLIERS,
  DEFAULT_TERMS_AND_CONDITIONS,
  DEFAULT_TERMS_KEY,
  ensureDefaultSettings,
  ensureQuoteMarginSetting,
  getAllSettings,
  getCompanySizeMultipliers,
  getDefaultTermsAndConditions,
  getQuoteMarginPercent,
  setCompanySizeMultipliers,
  setDefaultTermsAndConditions,
  setQuoteMarginPercent,
  setSetting,
  updateSettings,
} from '../db/repositories/settings.js';

const databases: DB[] = [];
afterEach(async () => {
  while (databases.length) await databases.pop()?.close();
});

async function setup(): Promise<DB> {
  const db = await openDatabase(':memory:');
  databases.push(db);
  return db;
}

describe('quote margin settings', () => {
  it('falls back to 30 when nothing has been stored', async () => {
    assert.equal(await getQuoteMarginPercent(await setup()), 30);
  });

  it('stores admin edits and reads them back', async () => {
    const db = await setup();
    assert.equal(await setQuoteMarginPercent(db, 32.5, null), 32.5);
    assert.equal(await getQuoteMarginPercent(db), 32.5);
    assert.equal(await setQuoteMarginPercent(db, 35, null), 35);
    assert.equal(await getQuoteMarginPercent(db), 35);
  });

  it('rejects out-of-range edits without changing the stored value', async () => {
    const db = await setup();
    await setQuoteMarginPercent(db, 33, null);
    await assert.rejects(setQuoteMarginPercent(db, 36, null), /between 30 and 35/);
    assert.equal(await getQuoteMarginPercent(db), 33);
  });

  it('seeds the initial value only once', async () => {
    const db = await setup();
    assert.equal(await ensureQuoteMarginSetting(db, 31), 31);
    assert.equal(await ensureQuoteMarginSetting(db, 34), 31);
    assert.equal(await getQuoteMarginPercent(db), 31);
  });
});

describe('company size multipliers & default terms settings', () => {
  it('returns canonical defaults when keys are absent', async () => {
    const db = await setup();
    assert.deepEqual(await getCompanySizeMultipliers(db), DEFAULT_COMPANY_SIZE_MULTIPLIERS);
    assert.equal(await getDefaultTermsAndConditions(db), DEFAULT_TERMS_AND_CONDITIONS);
    assert.ok(DEFAULT_TERMS_AND_CONDITIONS.length > 50);
  });

  it('persists multipliers and terms with updated_by auditing and preserves empty string terms', async () => {
    const db = await setup();
    const auth = new AdminAuth(db, { sessionHours: 1 });
    const admin = await auth.createAdmin('settings-admin', 'a-long-test-password');

    const nextMultipliers = { '0-5': 1.1, '5-10': 1.75, '10-20': 2.25, '20+': 3.5 };
    assert.deepEqual(await setCompanySizeMultipliers(db, nextMultipliers, admin.id), nextMultipliers);
    assert.deepEqual(await getCompanySizeMultipliers(db), nextMultipliers);

    const customTerms = '1. Custom Terms\n2. Net 15 payment.';
    assert.equal(await setDefaultTermsAndConditions(db, customTerms, admin.id), customTerms);
    assert.equal(await getDefaultTermsAndConditions(db), customTerms);

    // Clearing terms to "" must persist "" instead of falling back to DEFAULT_TERMS_AND_CONDITIONS.
    assert.equal(await setDefaultTermsAndConditions(db, '', admin.id), '');
    assert.equal(await getDefaultTermsAndConditions(db), '');

    const rows = await db.query<{ key: string; updated_by: number | null }>(
      'SELECT key, updated_by FROM app_settings WHERE key = ANY($1)',
      [[COMPANY_SIZE_MULTIPLIERS_KEY, DEFAULT_TERMS_KEY]],
    );
    assert.equal(rows.rows.length, 2);
    for (const row of rows.rows) {
      assert.equal(Number(row.updated_by), admin.id);
    }
  });

  it('rejects invalid multiplier and terms inputs without mutating stored values', async () => {
    const db = await setup();
    const initial = { '0-5': 1.2, '5-10': 1.6, '10-20': 2.1, '20+': 3.1 };
    await setCompanySizeMultipliers(db, initial, null);

    await assert.rejects(
      setCompanySizeMultipliers(db, { ...initial, '0-5': 0 }, null),
      /positive finite number/,
    );
    await assert.rejects(
      setCompanySizeMultipliers(db, { ...initial, '5-10': -1 }, null),
      /positive finite number/,
    );
    await assert.rejects(
      setCompanySizeMultipliers(db, { ...initial, '10-20': Number.NaN }, null),
      /positive finite number/,
    );
    await assert.rejects(
      setCompanySizeMultipliers(db, { ...initial, '20+': Number.POSITIVE_INFINITY }, null),
      /positive finite number/,
    );
    assert.deepEqual(await getCompanySizeMultipliers(db), initial);

    await assert.rejects(
      setDefaultTermsAndConditions(db, 'x'.repeat(50_001), null),
      /50,000/,
    );
  });

  it('gracefully falls back when stored multipliers JSON is malformed or partially invalid', async () => {
    const db = await setup();

    await setSetting(db, COMPANY_SIZE_MULTIPLIERS_KEY, '{bad json', null);
    assert.deepEqual(await getCompanySizeMultipliers(db), DEFAULT_COMPANY_SIZE_MULTIPLIERS);

    await setSetting(db, COMPANY_SIZE_MULTIPLIERS_KEY, '[]', null);
    assert.deepEqual(await getCompanySizeMultipliers(db), DEFAULT_COMPANY_SIZE_MULTIPLIERS);

    await setSetting(db, COMPANY_SIZE_MULTIPLIERS_KEY, 'null', null);
    assert.deepEqual(await getCompanySizeMultipliers(db), DEFAULT_COMPANY_SIZE_MULTIPLIERS);

    await setSetting(
      db,
      COMPANY_SIZE_MULTIPLIERS_KEY,
      JSON.stringify({ '0-5': 1.25, '5-10': -1, '10-20': 'abc', '20+': null }),
      null,
    );
    assert.deepEqual(await getCompanySizeMultipliers(db), {
      '0-5': 1.25,
      '5-10': 1.5,
      '10-20': 2.0,
      '20+': 3.0,
    });
  });

  it('seeds defaults once via ensureDefaultSettings without overwriting admin edits', async () => {
    const db = await setup();
    const seeded = await ensureDefaultSettings(db, 31);
    assert.deepEqual(seeded, {
      quoteMarginPercent: 31,
      minMarginPercent: 30,
      maxMarginPercent: 35,
      companySizeMultipliers: DEFAULT_COMPANY_SIZE_MULTIPLIERS,
      defaultTermsAndConditions: DEFAULT_TERMS_AND_CONDITIONS,
    });

    await setQuoteMarginPercent(db, 34, null);
    await setCompanySizeMultipliers(db, { '0-5': 1.2, '5-10': 1.8, '10-20': 2.4, '20+': 3.6 }, null);
    await setDefaultTermsAndConditions(db, 'Edited Terms', null);

    const reseeded = await ensureDefaultSettings(db, 30);
    assert.equal(reseeded.quoteMarginPercent, 34);
    assert.deepEqual(reseeded.companySizeMultipliers, { '0-5': 1.2, '5-10': 1.8, '10-20': 2.4, '20+': 3.6 });
    assert.equal(reseeded.defaultTermsAndConditions, 'Edited Terms');
  });

  it('updates multiple settings atomically via updateSettings and rolls back on invalid fields', async () => {
    const db = await setup();
    const auth = new AdminAuth(db, { sessionHours: 1 });
    const admin = await auth.createAdmin('atomic-admin', 'a-long-test-password');

    const updated = await updateSettings(
      db,
      {
        quoteMarginPercent: 33,
        companySizeMultipliers: { '0-5': 1.05, '5-10': 1.55, '10-20': 2.05, '20+': 3.05 },
        defaultTermsAndConditions: 'Atomic Terms v1',
      },
      admin.id,
    );
    assert.equal(updated.quoteMarginPercent, 33);
    assert.equal(updated.defaultTermsAndConditions, 'Atomic Terms v1');

    // Empty patch is rejected
    await assert.rejects(updateSettings(db, {}, admin.id), /at least one setting/);

    // Invalid multiplier alongside valid margin must NOT persist margin
    await assert.rejects(
      updateSettings(
        db,
        {
          quoteMarginPercent: 35,
          companySizeMultipliers: { '0-5': 1.0, '5-10': 0, '10-20': 2.0, '20+': 3.0 },
        },
        admin.id,
      ),
      /positive finite number/,
    );
    const current = await getAllSettings(db);
    assert.equal(current.quoteMarginPercent, 33);
    assert.deepEqual(current.companySizeMultipliers, { '0-5': 1.05, '5-10': 1.55, '10-20': 2.05, '20+': 3.05 });
  });
});
