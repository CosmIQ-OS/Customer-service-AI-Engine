import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { TelegramAdapter, parseAdminChatIds } from './telegram.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('parseAdminChatIds', () => {
  it('keeps plain integers only', () => {
    assert.deepEqual(parseAdminChatIds('123, -456'), [123, -456]);
  });

  it('drops decimals, exponent notation, text and zero', () => {
    assert.deepEqual(parseAdminChatIds('12.5, 1e5, abc, 0, , 12'), [12]);
  });

  it('returns nothing for missing configuration', () => {
    assert.deepEqual(parseAdminChatIds(undefined), []);
    assert.deepEqual(parseAdminChatIds(''), []);
  });
});

describe('TelegramAdapter secret handling', () => {
  it('never exposes the bot token in a failed request error', async () => {
    const token = '123456:TEST-TOKEN-VALUE';
    globalThis.fetch = (async (url: string) => {
      const error = new TypeError('fetch failed');
      error.cause = new Error(`request to ${url} failed, reason: socket hang up`);
      throw error;
    }) as typeof fetch;

    const adapter = new TelegramAdapter({ token, polling: false });
    await assert.rejects(
      () => adapter.sendMessage('42', { reply: 'hello', intent: 'test', sessionId: 's', data: {} }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.ok(!message.includes(token), 'the token must not appear in the error message');
        assert.ok(!message.includes('api.telegram.org/bot'), 'the bot API URL must not appear in the error message');
        assert.match(message, /sendMessage request failed/);
        return true;
      },
    );
  });

  it('never exposes the bot token in an API error description', async () => {
    const token = '123456:TEST-TOKEN-VALUE';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, description: `bad token ${token}` }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    const adapter = new TelegramAdapter({ token, polling: false });
    await assert.rejects(
      () => adapter.sendMessage('42', { reply: 'hello', intent: 'test', sessionId: 's', data: {} }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.ok(!message.includes(token), 'the token must not appear in the error message');
        return true;
      },
    );
  });
});

describe('TelegramAdapter admin alerts', () => {
  it('sends alerts only to the configured integer chat ids', async () => {
    const calls: Array<{ chatId: unknown; text: string }> = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { chat_id: unknown; text: string };
      calls.push({ chatId: body.chat_id, text: body.text });
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const adapter = new TelegramAdapter({ token: '123456:TEST-TOKEN-VALUE', adminChatIds: [111, 222] });
    const sent = await adapter.notifyAdmins('quote is waiting for approval');

    assert.equal(sent, 2);
    assert.deepEqual(calls.map((call) => call.chatId), [111, 222]);
  });

  it('ignores malformed chat ids', async () => {
    const calls: Array<{ chatId: unknown }> = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { chat_id: unknown };
      calls.push({ chatId: body.chat_id });
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const adapter = new TelegramAdapter({
      token: '123456:TEST-TOKEN-VALUE',
      adminChatIds: [Number.NaN, 0, 12.5],
    });
    const sent = await adapter.notifyAdmins('alert');

    assert.equal(sent, 0);
    assert.equal(calls.length, 0);
  });

  it('does not send anything without a token', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const adapter = new TelegramAdapter({ token: '', adminChatIds: [111] });
    const sent = await adapter.notifyAdmins('alert');

    assert.equal(sent, 0);
    assert.equal(called, false);
  });
});
