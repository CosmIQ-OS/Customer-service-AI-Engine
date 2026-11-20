import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redactSecrets } from './service.js';

describe('invoice error redaction', () => {
  it('masks credential-looking fragments before they are stored or returned', () => {
    const cases = [
      'Upstream failed: X-API-TOKEN: super-secret-token',
      'authorization=Bearer abc.def.ghi',
      'api_key: "live-key-value"',
      'token=abc123 password=hunter2',
      'x-api-token: abc\nnext line',
    ];
    for (const input of cases) {
      const output = redactSecrets(input);
      assert.doesNotMatch(output, /super-secret-token|abc\.def\.ghi|live-key-value|abc123|hunter2|abc\s*\n/, input);
      assert.match(output, /\[redacted\]/, input);
    }
  });

  it('strips control characters and caps the stored message', () => {
    const output = redactSecrets(`${'\u0000\u001b[31m'}boom${'x'.repeat(2000)}`);
    assert.doesNotMatch(output, /[\u0000-\u001f\u007f]/);
    assert.equal(output.length, 500);
  });
});
