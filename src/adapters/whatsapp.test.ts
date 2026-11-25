import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { WhatsAppAdapter, parseAdminPhoneNumbers } from './whatsapp.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('parseAdminPhoneNumbers', () => {
  it('normalizes valid E.164 phone numbers and deduplicates them', () => {
    assert.deepEqual(
      parseAdminPhoneNumbers('+91 98765-43210, 919876543210; 123, +1 (415) 555-0199'),
      ['919876543210', '14155550199'],
    );
    assert.deepEqual(parseAdminPhoneNumbers(undefined), []);
  });
});

describe('WhatsAppAdapter', () => {
  it('normalizes a valid Meta Cloud API text message payload', () => {
    const adapter = new WhatsAppAdapter({ accessToken: '', phoneNumberId: '' });
    const msg = adapter.normalize({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: 'Asha' } }],
                messages: [
                  {
                    id: 'wamid.HBg123',
                    from: '919876543210',
                    timestamp: '1700000000',
                    text: { body: 'Hello CosmIQ' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    assert.ok(msg);
    assert.equal(msg.channel, 'whatsapp');
    assert.equal(msg.externalUserId, '919876543210');
    assert.equal(msg.text, 'Hello CosmIQ');
    assert.equal(msg.metadata?.name, 'Asha');
    assert.equal(msg.metadata?.messageId, 'wamid.HBg123');
  });

  it('returns null for status-only or malformed webhook payloads', () => {
    const adapter = new WhatsAppAdapter({ accessToken: '', phoneNumberId: '' });
    assert.equal(adapter.normalize(null), null);
    assert.equal(adapter.normalize({ entry: [{ changes: [{ value: { statuses: [{ status: 'delivered' }] } }] }] }), null);
  });

  it('redacts the access token from Graph API error messages', async () => {
    const secretToken = 'EAAG_super_secret_token_999';
    globalThis.fetch = (async () =>
      new Response(`Invalid token ${secretToken}`, { status: 401 })) as typeof fetch;

    const adapter = new WhatsAppAdapter({
      accessToken: secretToken,
      phoneNumberId: '1234567890',
    });

    await assert.rejects(
      adapter.sendMessage('919876543210', { reply: 'Hi', intent: 'assistant', sessionId: 's1' }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.doesNotMatch(err.message, /EAAG_super_secret_token_999/);
        assert.match(err.message, /\[redacted\]/);
        return true;
      },
    );
  });
});
