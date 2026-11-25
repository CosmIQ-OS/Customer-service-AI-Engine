import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from './index.js';

describe('loadConfig', () => {
  it('defaults to the credential-free mock provider', () => {
    assert.equal(loadConfig({}).LLM_PROVIDER, 'mock');
  });

  it('accepts openai as an alias for openai-compatible', () => {
    const config = loadConfig({ LLM_PROVIDER: 'openai' });
    assert.equal(config.LLM_PROVIDER, 'openai-compatible');
  });

  it('keeps the canonical provider name unchanged', () => {
    const config = loadConfig({ LLM_PROVIDER: 'openai-compatible' });
    assert.equal(config.LLM_PROVIDER, 'openai-compatible');
  });

  it('defaults the quote margin, approval window, and idle timeout', () => {
    const config = loadConfig({});
    assert.equal(config.QUOTE_MARGIN_PERCENT, 30);
    assert.equal(config.QUOTE_APPROVAL_WINDOW_HOURS, 6);
    assert.equal(config.CONVERSATION_IDLE_MINUTES, 60);
  });

  it('accepts margins only within the 30-35 percent range', () => {
    assert.equal(loadConfig({ QUOTE_MARGIN_PERCENT: '35' }).QUOTE_MARGIN_PERCENT, 35);
    assert.throws(() => loadConfig({ QUOTE_MARGIN_PERCENT: '29' }));
    assert.throws(() => loadConfig({ QUOTE_MARGIN_PERCENT: '36' }));
  });

  it('parses the cookie flag, trust proxy flag, and treats blank secrets as unset', () => {
    const config = loadConfig({
      COOKIE_SECURE: 'true',
      TRUST_PROXY: 'true',
      CHANNEL_WEBHOOK_SECRET: '',
      WHATSAPP_APP_SECRET: '   ',
    });
    assert.equal(config.COOKIE_SECURE, true);
    assert.equal(config.TRUST_PROXY, true);
    assert.equal(config.CHANNEL_WEBHOOK_SECRET, undefined);
    assert.equal(config.WHATSAPP_APP_SECRET, undefined);
    assert.equal(loadConfig({}).COOKIE_SECURE, false);
    assert.equal(loadConfig({}).TRUST_PROXY, false);
    assert.equal(loadConfig({ WHATSAPP_APP_SECRET: 'secret123' }).WHATSAPP_APP_SECRET, 'secret123');
  });

  it('rejects webhook secrets shorter than 16 characters', () => {
    assert.throws(() => loadConfig({ CHANNEL_WEBHOOK_SECRET: 'short' }));
  });

  it('validates DATABASE_URL and DATABASE_URL_UNPOOLED when provided and ignores blank strings', () => {
    assert.equal(loadConfig({ DATABASE_URL: '', DATABASE_URL_UNPOOLED: '' }).DATABASE_URL, undefined);
    assert.equal(loadConfig({ DATABASE_URL_UNPOOLED: '' }).DATABASE_URL_UNPOOLED, undefined);
    assert.equal(
      loadConfig({
        DATABASE_URL: 'postgresql://user:pass@ep-cool-pooler.neon.tech/neondb?sslmode=require',
        DATABASE_URL_UNPOOLED: 'postgresql://user:pass@ep-cool.neon.tech/neondb?sslmode=require',
      }).DATABASE_URL_UNPOOLED,
      'postgresql://user:pass@ep-cool.neon.tech/neondb?sslmode=require',
    );
    assert.throws(() => loadConfig({ DATABASE_URL: 'sqlite://local.db' }), /postgres/);
    assert.throws(() => loadConfig({ DATABASE_URL_UNPOOLED: 'http://invalid' }), /postgres/);
  });
});
