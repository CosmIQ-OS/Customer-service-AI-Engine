import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openDatabase, type DB } from '../db/database.js';
import {
  ensureQuoteMarginSetting,
  getQuoteMarginPercent,
  setQuoteMarginPercent,
} from '../db/repositories/settings.js';

const databases: DB[] = [];
afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

function setup(): DB {
  const db = openDatabase(':memory:');
  databases.push(db);
  return db;
}

describe('quote margin settings', () => {
  it('falls back to 30 when nothing has been stored', () => {
    assert.equal(getQuoteMarginPercent(setup()), 30);
  });

  it('stores admin edits and reads them back', () => {
    const db = setup();
    assert.equal(setQuoteMarginPercent(db, 32.5, null), 32.5);
    assert.equal(getQuoteMarginPercent(db), 32.5);
    assert.equal(setQuoteMarginPercent(db, 35, null), 35);
    assert.equal(getQuoteMarginPercent(db), 35);
  });

  it('rejects out-of-range edits without changing the stored value', () => {
    const db = setup();
    setQuoteMarginPercent(db, 33, null);
    assert.throws(() => setQuoteMarginPercent(db, 36, null), /between 30 and 35/);
    assert.equal(getQuoteMarginPercent(db), 33);
  });

  it('seeds the initial value only once', () => {
    const db = setup();
    assert.equal(ensureQuoteMarginSetting(db, 31), 31);
    assert.equal(ensureQuoteMarginSetting(db, 34), 31);
    assert.equal(getQuoteMarginPercent(db), 31);
  });
});
