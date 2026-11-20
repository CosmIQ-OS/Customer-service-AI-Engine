import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openDatabase, type DB } from '../db/database.js';
import { AdminAuth } from './admin-auth.js';

const databases: DB[] = [];
afterEach(async () => {
  while (databases.length) await databases.pop()?.close();
});

const PASSWORD = 'a-long-test-password';

async function createAuth(options: { maxFailures?: number } = {}): Promise<AdminAuth> {
  const db = await openDatabase(':memory:');
  databases.push(db);
  return new AdminAuth(db, { sessionHours: 1, ...options });
}

describe('AdminAuth', () => {
  it('reports no admins until one is created', async () => {
    const auth = await createAuth();
    assert.equal(await auth.hasAdmins(), false);
    await auth.createAdmin('owner', PASSWORD);
    assert.equal(await auth.hasAdmins(), true);
  });

  it('rejects weak passwords and invalid usernames', async () => {
    const auth = await createAuth();
    await assert.rejects(auth.createAdmin('owner', 'short'), /at least|characters/);
    await assert.rejects(auth.createAdmin('bad name!', PASSWORD), /Username must/);
  });

  it('refuses duplicate usernames regardless of case', async () => {
    const auth = await createAuth();
    await auth.createAdmin('Owner', PASSWORD);
    await assert.rejects(auth.createAdmin('owner', PASSWORD), /already exists/);
  });

  it('issues a session token that resolves to the admin until logout', async () => {
    const auth = await createAuth();
    await auth.createAdmin('owner', PASSWORD, 'Owner');
    const result = await auth.login('owner', PASSWORD, '127.0.0.1');
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal((await auth.resolve(result.token))?.username, 'owner');
    assert.equal(await auth.resolve('not-a-real-token'), undefined);
    assert.equal(await auth.resolve(undefined), undefined);

    await auth.logout(result.token);
    assert.equal(await auth.resolve(result.token), undefined);
  });

  it('rejects a wrong password and an unknown user the same way', async () => {
    const auth = await createAuth();
    await auth.createAdmin('owner', PASSWORD);
    assert.deepEqual(await auth.login('owner', 'wrong-password-here', 'ip'), { ok: false, reason: 'invalid' });
    assert.deepEqual(await auth.login('nobody', PASSWORD, 'ip'), { ok: false, reason: 'invalid' });
  });

  it('treats sessions past their expiry as signed out', async () => {
    const auth = await createAuth();
    await auth.createAdmin('owner', PASSWORD);
    const start = Date.now();
    const result = await auth.login('owner', PASSWORD, 'ip', start);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal((await auth.resolve(result.token, start + 30 * 60_000))?.username, 'owner');
    assert.equal(await auth.resolve(result.token, start + 2 * 3_600_000), undefined);
  });

  it('locks a user and client after repeated failures, even with the right password', async () => {
    const auth = await createAuth({ maxFailures: 3 });
    await auth.createAdmin('owner', PASSWORD);
    const now = Date.now();
    for (let i = 0; i < 3; i++) await auth.login('owner', 'wrong-password-here', 'ip', now);

    assert.deepEqual(await auth.login('owner', PASSWORD, 'ip', now), { ok: false, reason: 'locked' });
    const otherClient = await auth.login('owner', PASSWORD, 'other-ip', now);
    assert.equal(otherClient.ok, true);
  });

  it('resets a password, signs out existing sessions, and rejects unknown users', async () => {
    const auth = await createAuth();
    await auth.createAdmin('owner', PASSWORD);
    const before = await auth.login('owner', PASSWORD, 'ip');
    assert.equal(before.ok, true);
    if (!before.ok) return;

    await auth.setPassword('owner', 'a-brand-new-password');
    assert.equal(await auth.resolve(before.token), undefined);
    assert.deepEqual(await auth.login('owner', PASSWORD, 'ip'), { ok: false, reason: 'invalid' });
    assert.equal((await auth.login('owner', 'a-brand-new-password', 'ip')).ok, true);

    await assert.rejects(auth.setPassword('nobody', 'a-brand-new-password'), /not found/);
    await assert.rejects(auth.setPassword('owner', 'short'), /characters/);
  });
});
