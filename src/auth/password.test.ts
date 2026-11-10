import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies the original password and rejects others', async () => {
    const stored = await hashPassword('correct horse battery');
    assert.equal(await verifyPassword('correct horse battery', stored), true);
    assert.equal(await verifyPassword('wrong horse battery', stored), false);
  });

  it('salts each hash so equal passwords produce different values', async () => {
    const first = await hashPassword('same-password-here');
    const second = await hashPassword('same-password-here');
    assert.notEqual(first, second);
  });

  it('returns false for malformed stored hashes instead of throwing', async () => {
    assert.equal(await verifyPassword('anything', 'not-a-hash'), false);
    assert.equal(await verifyPassword('anything', 'scrypt$x$y$z$$'), false);
  });
});
