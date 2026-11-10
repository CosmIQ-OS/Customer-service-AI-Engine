import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { it } from 'node:test';
import { OpenAICompatibleProvider } from './openai-compatible.js';

it('serializes tools and parses an OpenAI-compatible tool call', async () => {
  let received: any;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      received = JSON.parse(body);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        choices: [{ message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'search_faq', arguments: '{"query":"support hours"}' },
          }],
        } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');

  try {
    const provider = new OpenAICompatibleProvider({
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: 'test-key',
      timeoutMs: 2_000,
    });
    const result = await provider.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'What are your hours?' }],
      tools: [{ name: 'search_faq', description: 'Search FAQs', parameters: { type: 'object' } }],
    });

    assert.equal(received.model, 'test-model');
    assert.equal(received.tools[0].function.name, 'search_faq');
    assert.equal(result.message.toolCalls?.[0].name, 'search_faq');
    assert.deepEqual(result.message.toolCalls?.[0].arguments, { query: 'support hours' });
    assert.equal(result.usage.totalTokens, 14);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
