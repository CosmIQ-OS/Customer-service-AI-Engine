import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { createRateLimiter } from './rate-limiter.js';

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length) {
    const srv = servers.pop()!;
    await new Promise<void>((resolve) => {
      srv.closeAllConnections();
      srv.close(() => resolve());
    });
  }
});

async function startLimiterApp(options: { trustProxy?: boolean; max?: number; maxEntries?: number } = {}) {
  const app = express();
  if (options.trustProxy) app.set('trust proxy', 1);
  app.post(
    '/limited',
    createRateLimiter({ windowMs: 60_000, max: options.max ?? 2, maxEntries: options.maxEntries }),
    (_req, res) => res.json({ ok: true }),
  );
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe('createRateLimiter', () => {
  it('ignores spoofed X-Forwarded-For headers when trust proxy is disabled', async () => {
    const base = await startLimiterApp({ trustProxy: false, max: 2 });
    const r1 = await fetch(`${base}/limited`, { method: 'POST', headers: { 'x-forwarded-for': '1.1.1.1' } });
    const r2 = await fetch(`${base}/limited`, { method: 'POST', headers: { 'x-forwarded-for': '2.2.2.2' } });
    const r3 = await fetch(`${base}/limited`, { method: 'POST', headers: { 'x-forwarded-for': '3.3.3.3' } });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 429);
  });

  it('respects X-Forwarded-For when trust proxy is enabled and bounds memory via maxEntries', async () => {
    const base = await startLimiterApp({ trustProxy: true, max: 1, maxEntries: 2 });
    const r1 = await fetch(`${base}/limited`, { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.1' } });
    const r2 = await fetch(`${base}/limited`, { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.2' } });
    const r3 = await fetch(`${base}/limited`, { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.3' } });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 200);
  });
});
