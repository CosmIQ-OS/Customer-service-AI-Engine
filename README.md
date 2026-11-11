# Business Support AI Engine

A modular AI customer-service engine for chat channels such as **WhatsApp** and **Telegram**. It combines an OpenAI-compatible LLM, a bounded agent loop, support tools, SQLite persistence, conversation transcripts, execution traces, and a minimal React dashboard.

The default `mock` provider runs locally without credentials. Configure any OpenAI-compatible `/v1/chat/completions` endpoint for live AI responses.

## Architecture

```text
src/
  config/                 # Zod-validated environment configuration
  llm/                    # Provider contract, OpenAI-compatible client, mock, prompts
  kernel/                 # Agent loop, context builder, tool registry
  tools/                  # Services, FAQs, requests, profile, human escalation
  memory/                 # Four-tier memory (Phase 2)
  engine/                 # Channel-agnostic orchestration and session store
  adapters/               # Telegram and WhatsApp channel adapters
  db/
    schema.sql            # Base SQLite schema (WAL, indexes)
    migrations/           # Ordered, idempotent schema upgrades
    repositories/         # Data access for all persisted records
  server/app.ts           # REST API + optional dashboard static hosting
dashboard/                # Vite + React dashboard
data/                     # SQLite DB files (created at runtime)
```

### Agent flow

```text
Inbound message
  -> load/create session
  -> append user message to transcript
  -> build context from recent transcript
  -> LLM call with support tool definitions
  -> validate and execute tool calls (Zod)
  -> return observations to the LLM (up to AGENT_MAX_STEPS)
  -> append assistant reply, update session, write logs and trace
  -> channel adapter sends the reply
```

The agent accesses business data only through tools:

- `list_services` — real service catalog and availability.
- `search_faq` — enabled FAQ lookup.
- `create_support_request` — persistent support request with a real ID.
- `get_customer_profile` — current customer/session context.
- `escalate_to_human` — escalation request and session handoff state.
- `save_intake` — company name, company size, current tools, and service wanted.
- `get_intake` — recall the intake details already collected for the session.

Adding a capability means adding a tool and registering it in `src/tools/index.ts`; the channel adapters and HTTP API do not change.

### Service intake

The front agent collects four details before a quote can be prepared: company name, company size, current tools, and the Cosmiq service the customer wants. The detected language is stored on the session and included in the system prompt, and intake rows are visible to admins in the dashboard and at `GET /api/intakes`.

The front agent never states a price. A deterministic guard also checks each reply and replaces any reply containing a currency amount with a price-free holding message, logging a `price.blocked` event.

## Setup

```bash
cp .env.example .env
npm run setup
```

The default configuration uses the mock provider. For a live provider:

```dotenv
LLM_PROVIDER=openai-compatible
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=your-key
LLM_MODEL=gpt-4o-mini
```

`OPENAI_BASE_URL` can point to any compatible provider, including a local server. `AGENT_MAX_STEPS`, `AGENT_MAX_HISTORY`, `AGENT_TEMPERATURE`, and `LLM_TIMEOUT_MS` bound model execution and context size.

### Admin accounts

The dashboard and every `/api` route except health and sign-in require an admin session. Create the first admin before signing in:

```bash
read -s ADMIN_PASSWORD && export ADMIN_PASSWORD
npm run admin:create -- <username> "<display name>"
```

Passwords must be 12–256 characters. Five failed sign-ins for the same user and client within 15 minutes lock that pair for the rest of the window. To reset a forgotten password (this also signs out that admin's existing sessions):

```bash
read -s ADMIN_PASSWORD && export ADMIN_PASSWORD
npm run admin:passwd -- <username>
```

Channel webhooks (`POST /api/channels/:channel/inbound`) use the `x-webhook-secret` header set to `CHANNEL_WEBHOOK_SECRET` instead of an admin session.

Set `COOKIE_SECURE=true` when the dashboard is served over HTTPS, for example through a Cloudflare tunnel.

## Run

API/server (includes seed data on first run):

```bash
npm run dev
```

Dashboard (separate terminal):

```bash
npm run dashboard:dev
```

- API: `http://localhost:3001`
- Dashboard dev: `http://localhost:5173` (proxies `/api` to port 3001)

## Test and build

```bash
npm test
npm run build
```

Tests cover tool execution, request creation, transcript continuity, and OpenAI-compatible request/response serialization using a local HTTP fixture.

## Key API endpoints

- `GET /api/dashboard/summary` — counts + recent logs/requests/services
- `GET|POST|PATCH /api/services` — service availability management
- `GET|POST|PATCH /api/faqs` — FAQ management
- `GET /api/requests` — chat requests
- `GET /api/logs` — chat logs
- `GET /api/sessions` — persisted session contexts
- `GET /api/sessions/:id/messages` — chronological conversation transcript
- `GET /api/traces` — model latency, token use, steps, and tool calls
- `POST /api/chat/simulate` — simulate a channel message through the agent
- `POST /api/channels/:channel/inbound` — normalized adapter ingress

### Simulate a chat message

```bash
curl -X POST http://localhost:3001/api/chat/simulate \
  -H "Content-Type: application/json" \
  -d '{"channel":"whatsapp","externalUserId":"user-123","text":"What services are available?"}'
```

The response includes the reply, session ID, derived intent, model usage, and executed tool calls.

## Connecting Telegram / WhatsApp

The engine is channel-agnostic. The adapters already normalize platform payloads and implement the common `ChannelAdapter` contract, but external delivery is still a stub:

- **Telegram**: add Telegraf/grammY, launch a bot or webhook, pass normalized updates to `engine.handleMessage(...)`, and send replies with the Telegram API.
- **WhatsApp**: configure Meta WhatsApp Business webhooks, verify payload signatures, normalize messages, call `engine.handleMessage(...)`, and send replies via the Graph API.

## Database and migrations

SQLite runs in WAL mode with foreign keys enabled. The repository layer isolates SQL so storage can move to PostgreSQL later without changing tool or channel contracts.

`src/db/migrations/` contains ordered SQL migrations. Applied filenames are recorded in `schema_migrations`, allowing existing databases to upgrade without being recreated. Phase 1 adds `messages` (conversation transcripts) and `traces` (agent execution records), both tenant-scoped for future multi-tenancy.

## Roadmap

- **Phase 2:** four-tier memory — transcript, rolling summary, durable user facts, semantic episodic recall.
- **Phase 3:** production WhatsApp Cloud API webhook and delivery.
- **Phase 4:** live conversations, memory inspector, and prompt playground in the dashboard.
- **Phase 5:** golden-conversation evaluation harness.
