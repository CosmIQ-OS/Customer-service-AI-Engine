---
title: Cosmiq Support Engine
emoji: 🤖
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 3001
pinned: false
license: apache-2.0
---

# Business Support AI Engine

A modular AI customer-service engine for chat channels such as **WhatsApp** and **Telegram**. It combines an OpenAI-compatible LLM, a bounded agent loop, support tools, **PostgreSQL persistence (Neon in production, embedded PGlite locally)**, conversation transcripts, execution traces, and a React dashboard.

The default `mock` provider runs locally without credentials. Configure any OpenAI-compatible `/v1/chat/completions` endpoint for live AI responses.

> 📖 **Recent Changes & Team Guide:** See [CHANGES_SUMMARY.md](./CHANGES_SUMMARY.md) for a plain-English breakdown of recent upgrades, WhatsApp tool fixes, auto-pricing features, and the PostgreSQL (Neon) migration.

## Architecture

```text
src/
  config/                 # Zod-validated environment configuration (DATABASE_URL, LLM, channels)
  llm/                    # Provider contract, OpenAI-compatible client, mock, prompts
  kernel/                 # Agent loop, context builder, tool registry
  tools/                  # Services, FAQs, requests, profile, intake, escalation
  intake/                 # Intake fields and language detection
  pricing/                # Price-table parsing, pricing agent, quote builder, margin
  approvals/              # Approval workflow, reminders, customer quote messages
  memory/                 # Four-tier memory (Phase 2)
  engine/                 # Channel-agnostic orchestration and session store
  adapters/               # Telegram and WhatsApp channel adapters
  db/
    database.ts           # PostgreSQL driver (pg Pool for Neon/external Postgres, PGlite locally)
    schema.sql            # Base PostgreSQL schema & indexes
    migrations/           # Ordered, idempotent PostgreSQL schema upgrades (advisory-locked)
    repositories/         # Async data access for all persisted records
  cli/
    migrate-sqlite.ts     # Idempotent SQLite -> PostgreSQL/Neon data migration utility
  server/app.ts           # REST API + optional dashboard static hosting
dashboard/                # Vite + React dashboard
data/                     # Local PGlite Postgres data (used only when DATABASE_URL is unset)
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

### Quotes and margin

When an intake is complete, a separate pricing agent selects the required line items from the service's active price table. Item codes, descriptions, units, and admin prices come from that table unchanged. The system then applies the configured markup and queues the quote for admin approval.

The markup is editable at any time between 30% and 35% in the dashboard or with `PUT /api/settings/quote-margin`. `QUOTE_MARGIN_PERCENT` only seeds the starting value; changing the environment variable later does not overwrite an admin's saved choice. Existing quotes keep the margin they were built with.

`PRICING_LLM_MODEL` optionally points the pricing agent at a stronger model than the front agent; it defaults to `LLM_MODEL`. Quotes are available at `GET /api/quotes` and in the dashboard.

### Approval and delivery

Every new quote enters the admin approval queue as `pending_approval` with a six-hour window (`QUOTE_APPROVAL_WINDOW_HOURS`). Admins review it in the dashboard Approval Queue, can change line quantities and the 30–35% margin, and then approve or reject it. Item codes, descriptions, units, and admin prices stay locked to the uploaded price table. The server checks every minute and, when the window lapses without a decision, stores a new admin alert and sends the customer a price-free holding update. Reminders repeat every six hours until a decision; the quote never expires on its own.

Approving sends the customer an itemized quote in INR through the channel adapter (stub-logged until Telegram is live). Rejecting sends a price-free message that a specialist will follow up, and keeps any internal note with the quote. Admin alerts are stored in `admin_notifications` and shown in the dashboard; the same records will feed Telegram alerts in the Telegram phase.

Approval endpoints:

- `GET /api/approvals` — pending quotes, counts, recent alerts
- `PATCH /api/quotes/:id` — quantities and/or margin before approval
- `POST /api/quotes/:id/approve` — approve and deliver the itemized quote
- `POST /api/quotes/:id/reject` — reject with an optional internal note
- `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`

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
# Optional: a stronger model for the pricing agent
PRICING_LLM_MODEL=gpt-4.1-mini
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
- `GET /api/intakes` — company, size, tools, and service collected per session
- `GET /api/conversations`, `GET /api/conversations/needing-human` — live conversations
- `GET /api/conversations/:id/messages` — a conversation transcript
- `POST /api/conversations/:id/pause|takeover|handback|reply` — live conversation control
- `GET|POST /api/services/:id/price-table` — upload and publish a service price table (xlsx or csv)
- `GET /api/quotes`, `GET /api/quotes/:id`, `POST /api/quotes/build` — quote drafts and rebuilds
- `GET|PUT /api/settings`, `PUT /api/settings/quote-margin` — live markup, 30–35%
- `GET /api/approvals` — pending quotes, counts, and recent admin alerts
- `PATCH /api/quotes/:id` — edit quantities and margin before approval
- `POST /api/quotes/:id/approve`, `POST /api/quotes/:id/reject` — decide and deliver
- `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`
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

`src/db/migrations/` contains ordered SQL migrations. Applied filenames are recorded in `schema_migrations`, allowing existing databases to upgrade without being recreated. Do not edit a migration that has already been applied; add the next numbered file instead.

## Live conversations

The dashboard has a WhatsApp-style inbox. Every channel conversation is tracked in the `conversations` table with an owner:

- `ai` — the agent answers.
- `paused` — the AI is silent; messages are held for the team.
- `human` — an admin owns the chat and replies from the panel.

While a conversation is not owned by the AI, inbound messages are stored, the unread count rises, and admins get a notification. The agent returns an empty reply so nothing is sent to the customer. Admins can pause the AI, take over, reply manually, and hand the conversation back. A conversation left without a human reply for 60 minutes (`CONVERSATION_IDLE_MINUTES`) closes automatically and returns to the AI.

Endpoints:

- `GET /api/conversations` — all conversations with the last message and unread count
- `GET /api/conversations/needing-human` — conversations waiting for a human
- `GET /api/conversations/:id/messages` — the transcript
- `POST /api/conversations/:id/pause` — silence the AI
- `POST /api/conversations/:id/takeover` — take the chat
- `POST /api/conversations/:id/handback` — give it back to the AI
- `POST /api/conversations/:id/reply` — send a message as a human agent

## Telegram and WhatsApp delivery

With `TELEGRAM_BOT_TOKEN` set, the Telegram adapter long-polls the Bot API, forwards messages to the engine, and delivers replies through `sendMessage`. `TELEGRAM_ADMIN_CHAT_IDS` (comma-separated) receives operational alerts: quotes waiting for approval and customers who ask for a human. `TELEGRAM_POLLING=false` switches to webhook ingress only.

The WhatsApp adapter sends through the Meta WhatsApp Business Cloud API when `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are set. Without credentials both adapters stay in stub mode, so local development and tests need no accounts.

## Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the full runbook: prerequisites, configuration, local run, Docker deployment, live Telegram testing, and troubleshooting.

```bash
docker compose up -d --build            # engine on port 3001, data in a named volume
docker compose --profile tunnel up -d   # adds cloudflared when CLOUDFLARE_TUNNEL_TOKEN is set
```

The image builds the dashboard, installs the backend, and exposes a `/api/health` health check. Set `COOKIE_SECURE=true` when serving over HTTPS, which the compose file does by default.

## Roadmap

- **Done — foundations:** admin accounts, session cookies, webhook secret, dashboard sign-in.
- **Done — catalog:** per-service price tables (xlsx/csv), publish with versioning, Cosmiq services.
- **Done — intake:** company, size, tools, and service collection; language detection; price-free front agent.
- **Done — pricing:** pricing agent, editable 30–35% markup, draft quotes in INR paise.
- **Done — approval:** six-hour window, repeating admin alerts, quantity and margin edits, itemized delivery or price-free handoff.
- **Done — live conversations:** WhatsApp-style admin panel, one-hour idle timeout, pause AI, take over, and hand back.
- **Done — Telegram:** real bot delivery and admin alerts.
- **Done — deployment:** self-hosted Docker and cloudflared.
- **Done — verification:** unit tests, typecheck, dashboard build, browser checks, golden-conversation eval, and dependency audit all green.
