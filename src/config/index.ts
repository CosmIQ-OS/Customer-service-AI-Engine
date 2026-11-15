import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DB_PATH: z.string().min(1).default('./data/support.db'),
  DASHBOARD_ORIGIN: z.string().optional(),
  SESSION_TTL_MINUTES: z.coerce.number().positive().default(120),
  TENANT_ID: z.string().min(1).default('default'),
  LLM_PROVIDER: z.preprocess(
    (value) => value === 'openai' ? 'openai-compatible' : value,
    z.enum(['mock', 'openai-compatible']).default('mock'),
  ),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().min(1).default('gpt-4o-mini'),
  PRICING_LLM_MODEL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  PRICING_AGENT_TEMPERATURE: z.coerce.number().min(0).max(1).default(0),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(20).default(6),
  AGENT_MAX_HISTORY: z.coerce.number().int().min(2).max(100).default(12),
  AGENT_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  ADMIN_SESSION_HOURS: z.coerce.number().positive().max(168).default(12),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  CHANNEL_WEBHOOK_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(16).optional(),
  ),
  QUOTE_MARGIN_PERCENT: z.coerce.number().min(30).max(35).default(30),
  QUOTE_APPROVAL_WINDOW_HOURS: z.coerce.number().positive().max(72).default(6),
  CONVERSATION_IDLE_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ADMIN_CHAT_IDS: z.string().optional(),
  TELEGRAM_POLLING: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
