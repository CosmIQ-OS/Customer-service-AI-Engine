import type { AppConfig } from '../config/index.js';
import type { LLMProvider } from './types.js';
import { MockLLMProvider } from './mock.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

export function createLLMProvider(config: AppConfig): LLMProvider {
  if (config.LLM_PROVIDER === 'mock') return new MockLLMProvider();
  if (!config.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai-compatible');
  }
  return new OpenAICompatibleProvider({
    baseUrl: config.OPENAI_BASE_URL,
    apiKey: config.OPENAI_API_KEY,
    timeoutMs: config.LLM_TIMEOUT_MS,
  });
}

export * from './types.js';
export { MockLLMProvider } from './mock.js';
export { OpenAICompatibleProvider } from './openai-compatible.js';
