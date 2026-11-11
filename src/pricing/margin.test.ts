import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_QUOTE_MARGIN, MIN_QUOTE_MARGIN, applyMargin, normalizeMarginPercent } from './margin.js';

describe('quote margin', () => {
  it('accepts the allowed range and normalizes to two decimals', () => {
    assert.equal(normalizeMarginPercent(MIN_QUOTE_MARGIN), 30);
    assert.equal(normalizeMarginPercent(MAX_QUOTE_MARGIN), 35);
    assert.equal(normalizeMarginPercent(32.555), 32.56);
  });

  it('rejects values outside 30-35', () => {
    assert.throws(() => normalizeMarginPercent(29.99), /between 30 and 35/);
    assert.throws(() => normalizeMarginPercent(35.01), /between 30 and 35/);
    assert.throws(() => normalizeMarginPercent(Number.NaN), /number/);
  });

  it('applies markup to integer paise and rounds the unit price', () => {
    assert.equal(applyMargin(100_000, 30), 130_000);
    assert.equal(applyMargin(100_000, 35), 135_000);
    assert.equal(applyMargin(999, 30), 1_299);
    assert.equal(applyMargin(0, 35), 0);
  });
});
