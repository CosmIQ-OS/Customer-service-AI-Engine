import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openDatabase, type DB } from '../db/database.js';
import {
  ensureQuoteMarginSetting,
  getQuoteMarginPercent,
  setQuoteMarginPercent,
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
