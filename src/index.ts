import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db/database.js';
import { SupportEngine } from './engine/support-engine.js';
import { TelegramAdapter, parseAdminChatIds } from './adapters/telegram.js';
import { WhatsAppAdapter } from './adapters/whatsapp.js';
import { createApp } from './server/app.js';
import { loadConfig } from './config/index.js';
import { createLLMProvider } from './llm/index.js';
import { AdminAuth } from './auth/admin-auth.js';
import { ensureQuoteMarginSetting } from './db/repositories/settings.js';

const config = loadConfig();

export function bootstrap() {
  const db = openDatabase(config.DB_PATH);
  const auth = new AdminAuth(db, { sessionHours: config.ADMIN_SESSION_HOURS });
  const llm = createLLMProvider(config);
  const engine = new SupportEngine(db, {
    sessionTtlMinutes: config.SESSION_TTL_MINUTES,
    llm,
    model: config.LLM_MODEL,
    maxSteps: config.AGENT_MAX_STEPS,
    maxHistory: config.AGENT_MAX_HISTORY,
    temperature: config.AGENT_TEMPERATURE,
    tenantId: config.TENANT_ID,
    pricingLlm: llm,
    pricingModel: config.PRICING_LLM_MODEL ?? config.LLM_MODEL,
    approvalWindowHours: config.QUOTE_APPROVAL_WINDOW_HOURS,
    conversationIdleMinutes: config.CONVERSATION_IDLE_MINUTES,
  });

  const telegram = new TelegramAdapter({
    token: config.TELEGRAM_BOT_TOKEN,
    adminChatIds: parseAdminChatIds(config.TELEGRAM_ADMIN_CHAT_IDS),
    polling: config.TELEGRAM_POLLING,
  });
  const whatsapp = new WhatsAppAdapter({
    accessToken: config.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
  });
  engine.adapters.register(telegram);
  engine.adapters.register(whatsapp);
  for (const adapter of engine.adapters.list()) {
    adapter.bind?.((message) => engine.handleMessage(message));
  }

  seedIfEmpty(engine);
  ensureQuoteMarginSetting(db, config.QUOTE_MARGIN_PERCENT);

  if (!auth.hasAdmins()) {
    console.warn('[auth] No admin accounts exist. Create one with: npm run admin:create -- <username>');
  }

  const app = createApp(engine, {
    auth,
    sessionHours: config.ADMIN_SESSION_HOURS,
    cookieSecure: config.COOKIE_SECURE,
    dashboardOrigin: config.DASHBOARD_ORIGIN,
    webhookSecret: config.CHANNEL_WEBHOOK_SECRET,
  });
  app.listen(config.PORT, () => {
    console.log(`[support-engine] API + dashboard server listening on http://localhost:${config.PORT}`);
    console.log(`[support-engine] DB: ${config.DB_PATH}`);
    console.log(`[support-engine] LLM: ${config.LLM_PROVIDER} / ${config.LLM_MODEL}`);
    console.log(`[support-engine] Pricing model: ${config.PRICING_LLM_MODEL ?? config.LLM_MODEL}`);
    console.log(`[support-engine] Quote approval window: ${config.QUOTE_APPROVAL_WINDOW_HOURS}h`);
  });

  startApprovalScheduler(engine);
  startConversationScheduler(engine);

  for (const adapter of engine.adapters.list()) {
    adapter.connect?.().catch((err) => console.error('[%s] connect error', adapter.channel, err));
  }

  return { db, engine, app };
}

/** Closes conversations that a human left idle, every minute. */
export function startConversationScheduler(engine: SupportEngine, intervalMs = 60_000): () => void {
  const tick = () => {
    try {
      const closed = engine.closeIdleConversations();
      if (closed.length > 0) {
        console.log(`[conversations] Closed ${closed.length} idle conversation(s).`);
      }
    } catch (error) {
      console.error('[conversations] idle sweep failed', error);
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/** Checks every minute for quotes that need an admin reminder; also catches up once on startup. */
export function startApprovalScheduler(engine: SupportEngine, intervalMs = 60_000): () => void {
  const tick = () => {
    engine
      .processDueApprovals()
      .then((result) => {
        if (result.realerted > 0) {
          console.log(`[approvals] Re-alerted admins about ${result.realerted} quote(s).`);
        }
      })
      .catch((error) => console.error('[approvals] reminder check failed', error));
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

const COSMIQ_SERVICES = [
  {
    name: 'Company Internal Operations Automation',
    description: 'Automation of recurring internal operations, such as approvals, reporting, and handoffs between teams.',
    category: 'automation',
  },
  {
    name: 'AI Native Internal System',
    description: 'Internal systems designed around AI from the start, including assistants for staff and knowledge search.',
    category: 'ai',
  },
  {
    name: 'Workflow Automation',
    description: 'End-to-end business workflows connected across the tools a team already uses.',
    category: 'workflow',
  },
  {
    name: 'WhatsApp Agent Services',
    description: 'AI agents for WhatsApp customer conversations, with human handoff when needed.',
    category: 'whatsapp',
  },
] as const;

function seedCosmiqServices(engine: SupportEngine) {
  const existing = new Set(engine.listServices().map((service) => service.name));
  for (const service of COSMIQ_SERVICES) {
    if (existing.has(service.name)) continue;
    engine.createService({ ...service, status: 'available', availability_note: '' });
  }
}

function seedIfEmpty(engine: SupportEngine) {
  if (engine.listServices().length === 0) {
    engine.createService({ name: 'Live Chat Support', description: 'Real-time assistance for account and product questions.', category: 'support', status: 'available', availability_note: 'Mon-Fri 09:00-18:00' });
    engine.createService({ name: 'Billing Assistance', description: 'Invoices, refunds, and payment methods.', category: 'billing', status: 'limited', availability_note: 'Email follow-up within 1 business day' });
    engine.createService({ name: 'API Integration Support', description: 'Developer onboarding and integration troubleshooting.', category: 'technical', status: 'maintenance', availability_note: 'Back online after scheduled maintenance' });
  }
  seedCosmiqServices(engine);
  if (engine.listFaqs().length === 0) {
    engine.createFaq({ question: 'What are your support hours?', answer: 'Live chat support is available Monday to Friday, 09:00-18:00 local business time.', tags: ['hours', 'support'] });
    engine.createFaq({ question: 'How can I check service availability?', answer: 'Ask "what services are available?" in chat, or view the Services panel in the dashboard.', tags: ['services', 'availability'] });
    engine.createFaq({ question: 'How do I submit a support request?', answer: 'Send your issue in chat and it will be logged as a request. You can also include details like account ID and screenshots.', tags: ['request', 'ticket'] });
  }
}

// Run when executed directly.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) bootstrap();
