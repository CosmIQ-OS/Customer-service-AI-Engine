# Architecture

## High-level architecture

This repository is a **modular TypeScript monolith** running as a single Node.js process. It combines:

- An **Express REST API**
- A React/Vite **operations dashboard**
- A channel-independent **customer support agent**
- Telegram and WhatsApp **channel adapters**
- A separate **pricing/quotation workflow**
- Human takeover and live-conversation management
- PostgreSQL persistence through either external PostgreSQL or embedded PGlite

The central idea is:

```text
Customer channel
      ↓
Channel adapter normalizes payload
      ↓
SupportEngine orchestrates the conversation
      ↓
AgentLoop calls LLM → tools → LLM until final reply
      ↓
Messages, sessions, traces, and logs are persisted
      ↓
Adapter sends the reply through the original channel
```

The important separation is that **channel adapters handle transport**, while **business actions happen inside validated tools**. Telegram and WhatsApp do not contain separate support/request/intake implementations.

> The current source uses **PostgreSQL/PGlite**, not SQLite as its primary database. Some older documentation and legacy SQLite-related paths may still exist.

---

# 1. Runtime composition and startup

The composition root is:

```text
src/index.ts
```

`bootstrap()` wires the application together:

1. Loads and validates configuration.
2. Opens PostgreSQL or PGlite.
3. Applies database migrations.
4. Creates admin authentication.
5. Creates the configured LLM provider.
6. Constructs `SupportEngine`.
7. Registers Telegram and WhatsApp adapters.
8. Binds inbound adapter messages to `SupportEngine.handleMessage()`.
9. Seeds services, FAQs, default price tables, and application settings.
10. Creates the initial admin when no admins exist.
11. Creates the Express application.
12. Starts the HTTP server.
13. Starts two background schedulers.
14. Connects live external adapters.

The same `SupportEngine` instance is shared by:

- HTTP endpoints
- Telegram inbound messages
- WhatsApp webhooks
- Conversation and quote schedulers
- Dashboard operations

### Background work

Two in-process polling schedulers run approximately every minute:

- `startApprovalScheduler()` — Finds pending quotes requiring another admin reminder.
- `startConversationScheduler()` — Closes human-owned or paused conversations that have remained idle beyond their deadline.

These are not external workers or distributed jobs. They run inside the main Node process.

---

# 2. Main module layers

```text
src/
├── index.ts                     Composition root and startup
├── config/                      Environment parsing and validation
├── server/                      Express application and operational routes
├── auth/                        Admin login, sessions, passwords, guards
├── engine/
│   ├── support-engine.ts        Central application orchestrator/façade
│   ├── sessions/                Session loading, caching, and updates
│   ├── conversations/           AI/human/paused conversation ownership
│   ├── channels/                Adapter contract and registry
│   ├── price-guard.ts           Outbound pricing safety check
│   └── types.ts                 Engine contracts
├── kernel/
│   ├── agent-loop.ts            Bounded LLM/tool execution loop
│   ├── context.ts               Prompt/history construction
│   └── tool-registry.ts         Tool registration and schemas
├── tools/                       Business capabilities exposed to agent
├── llm/                         Provider abstraction, OpenAI client, mock
├── adapters/                    Telegram and WhatsApp transport
├── intake/                      Intake helpers and language detection
├── pricing/                     Pricing agent, quote builder, PDFs
├── approvals/                   Quote approval state machine/reminders
├── db/
│   ├── database.ts              PG/PGlite adapter and migrations
│   ├── schema.sql               Base schema
│   ├── migrations/              Ordered schema evolution
│   └── repositories/            Aggregate-specific persistence
├── cli/                         Admin and migration utilities
└── **/*.test.ts                 Backend tests
```

The most important architectural boundary is:

```text
HTTP/channel adapters
        ↓
SupportEngine
        ↓
AgentLoop and operational services
        ↓
Tools / repositories
        ↓
DB abstraction
        ↓
PostgreSQL or PGlite
```

---

# 3. Channel architecture

The common adapter contract is in:

```text
src/engine/channels/adapter.ts
```

An adapter can:

- Normalize a platform payload into `InboundMessage`
- Send an `EngineResponse` back to the customer
- Bind itself directly to the inbound engine handler
- Connect/disconnect from the external platform
- Notify admins, where supported

`AdapterRegistry` stores adapters by channel name.

## Telegram

```text
src/adapters/telegram.ts
```

When configured:

- Validates the bot with Telegram's API
- Long-polls `getUpdates`
- Passes normalized messages into the engine
- Sends replies through `sendMessage`
- Sends operational alerts to configured admin chat IDs

Without credentials, it operates in log-only stub mode.

## WhatsApp

```text
src/adapters/whatsapp.ts
src/server/app.ts
```

WhatsApp is split between:

- **Outbound transport:** the adapter uses the WhatsApp Cloud API.
- **Inbound webhook:** Express receives and normalizes Meta webhook events.

The POST webhook acknowledges Meta first, then processes the message asynchronously.

## Web and simulation

There is no concrete web-delivery adapter. Channels such as `web`, `api`, and `website` can exist at the engine/session level.

`POST /api/chat/simulate` executes the normal engine flow and returns the reply in the HTTP response without attempting external channel delivery.

## Generic channel ingress

```http
POST /api/channels/:channel/inbound
x-webhook-secret: ...
```

This endpoint:

1. Authenticates using a shared secret.
2. Looks up the named adapter.
3. Normalizes the request payload.
4. Runs `SupportEngine.handleMessage()`.
5. Sends the reply through the adapter if one was generated.
6. Returns the resulting `EngineResponse`.

---

# 4. `SupportEngine`: the central orchestrator

The primary file is:

```text
src/engine/support-engine.ts
```

`SupportEngine` has two roles:

1. **Conversation orchestration** for inbound customer turns.
2. **Application façade** exposing repository-backed operations to Express.

Its main collaborators are:

```text
SupportEngine
├── SessionStore
├── AdapterRegistry
├── AgentLoop
├── PricingAgent
├── QuoteBuilder
├── ApprovalService
└── ConversationService
```

It also exposes operations for:

- Services and FAQs
- Support requests
- Sessions, messages, traces, and logs
- Website leads and intake records
- Quotes, invoices, proposals, and settings
- Notifications
- Live conversations and human replies

This makes it a convenient application boundary, although it is also the repository's largest and broadest class.

---

# 5. Inbound message lifecycle

`SupportEngine.handleMessage()` follows this sequence:

## Step 1: Resolve the session

```text
(channel, externalUserId) → persistent session
```

`SessionStore` maintains a process-local cache backed by the database.

The session stores information such as:

- Channel and external user ID
- Current status and last intent
- Arbitrary JSON context
- Detected language
- Known email
- Last message and reply
- Message count
- Handoff state

The durable transcript is stored separately in `messages`.

## Step 2: Enrich the session

The engine:

- Detects language heuristically.
- Extracts an email address if present.
- Updates the session and any existing intake with that information.

## Step 3: Persist ingress

Before invoking the model, it writes:

- An inbound `chat_logs` record
- A user message in the transcript
- Live-conversation activity/state

## Step 4: Check human ownership

`ConversationService.isAiActive()` determines the next action.

If the conversation is `human`, `paused`, or currently closed:

- The customer message remains persisted.
- Unread/operator state is updated.
- The LLM is not called.
- The engine returns an empty reply with intent `awaiting_human`.

## Step 5: Run the agent

For AI-owned conversations:

- Recent transcript messages are loaded chronologically.
- `AgentLoop.run()` executes the model/tool loop.
- `completeTurn()` persists the resulting reply and telemetry.

## Step 6: Check quote readiness

After the reply:

- The engine reloads the intake.
- If intake is ready and a quote exists, quote metadata is attached to the response.
- If intake just became ready through an intake turn, automatic quote generation begins.
- Quote-generation failures are logged without discarding the already generated customer reply.

---

# 6. Agent loop and model interaction

The loop is implemented in:

```text
src/kernel/agent-loop.ts
src/kernel/context.ts
src/kernel/tool-registry.ts
```

For each turn:

1. Build the system prompt and recent conversation history.
2. Send model configuration and tool definitions to the LLM.
3. If the model returns a final textual response, return it.
4. If it returns tool calls:
   - Record the assistant tool-call message.
   - Execute each tool sequentially.
   - Append tool observations.
   - Call the model again.
5. Stop after the configured maximum number of steps.

The loop accumulates:

- Tool calls and their observations
- Model steps
- Token usage
- Final reply

If it exhausts the step limit, it returns a specialist-follow-up fallback.

### Tool safety

Every tool defines:

- Name
- Description
- JSON Schema parameters for the model
- Zod schema for runtime validation
- Execution function

Invalid arguments, unknown tools, and execution failures become tool observations. They generally do not crash the entire turn.

The model therefore sees an error such as "tool failed" and is instructed not to claim success.

### Context construction

The context contains:

- Support-system prompt
- Channel and external customer ID
- Detected language
- Session context
- Recent persisted transcript

Prior tool-call execution trees are not reconstructed. Only the final durable user/assistant/human conversation history is replayed.

---

# 7. Agent tools and business capabilities

Tools are registered through:

```text
src/tools/index.ts
```

Seven tools are exposed:

| Tool | Purpose |
|---|---|
| `list_services` | Reads the current service catalog and availability |
| `search_faq` | Searches enabled FAQs and returns no-match when appropriate |
| `create_support_request` | Creates a real support request and returns its ID |
| `get_customer_profile` | Reads the current session identity and context |
| `escalate_to_human` | Creates an escalation request and marks session handoff state |
| `save_intake` | Accumulates and validates sales-intake fields |
| `get_intake` | Recalls previously collected intake information |

The repositories behind these tools provide the actual business behavior.

For example, `save_intake`:

- Merges new information rather than replacing the full record.
- Ignores blank updates instead of erasing known values.
- Resolves service names/IDs against the catalog.
- Reports which required fields remain missing.

Required intake fields are centered around:

- Company name
- Company size
- Current tools
- Desired service

Contact details enrich the intake but are not all required for chat completion.

### Important handoff distinction

Calling `escalate_to_human`:

- Creates an escalation request.
- Sets session handoff metadata.
- Triggers an operator alert.

It does **not by itself switch the live conversation to `human` mode**. Explicit dashboard pause/takeover is what suppresses subsequent AI replies.

---

# 8. LLM abstraction

Provider code is under:

```text
src/llm/
```

The common `LLMProvider.chat()` contract receives:

- Model
- Internal chat messages
- Tool definitions
- Temperature
- Optional token limit

It returns:

- Assistant content
- Optional tool calls
- Normalized token usage

## OpenAI-compatible provider

```text
src/llm/openai-compatible.ts
```

It:

- Calls the configured `/chat/completions` endpoint.
- Serializes function tools and tool observations.
- Supports OpenAI-compatible backends.
- Applies request timeouts.
- Parses tool arguments.
- Handles limited retry/fallback scenarios.
- Normalizes usage information.

## Deterministic mock provider

```text
src/llm/mock.ts
```

The default mock is designed for reproducible development and evaluation.

It uses deterministic parsing/rules to simulate:

- Service questions
- FAQ requests
- Support ticket creation
- Escalation
- Intake collection
- Pricing selection

It is not a general semantic language model. Tests can therefore run without network access or live credentials.

---

# 9. Intake-to-quote architecture

The quote flow uses a second, specialized model interaction rather than allowing the front-line support agent to produce prices.

```text
Intake becomes ready
        ↓
SupportEngine.buildQuoteForSession()
        ↓
Load active service price table
        ↓
PricingAgent selects catalog item codes and quantities
        ↓
Validate model output and active item codes
        ↓
QuoteBuilder calculates prices and margin
        ↓
Persist quote and immutable line-item snapshots
        ↓
Submit for admin approval
```

## Pricing agent

```text
src/pricing/pricing-agent.ts
```

It receives:

- Intake details
- Recent conversation history
- Active price-table items
- Admin unit prices

It returns structured JSON containing selected item codes, quantities, and reasoning.

Validation ensures:

- Selected items exist in the active table.
- Duplicate items are removed.
- Quantities are valid.
- Output conforms to the expected schema.

It cannot freely invent catalog prices.

## Quote builder

```text
src/pricing/quote-builder.ts
src/pricing/margin.ts
```

`QuoteBuilder`:

- Uses the active price table as the price authority.
- Applies the configured margin.
- Calculates totals in integer paise.
- Creates the quote and line items transactionally.
- Snapshots descriptions, units, admin prices, quoted prices, quantities, and totals.

This means later price-table edits do not silently rewrite existing quote line items.

## Approval and delivery

```text
src/approvals/approval-service.ts
```

New AI-generated quotes move into `pending_approval`.

Admins can:

- Change quantities.
- Change margin.
- Approve or reject the quote.

They cannot arbitrarily change line identity or admin base prices through that editing flow.

On approval:

1. The decision is persisted.
2. An itemized customer message is generated.
3. The message is added to the transcript.
4. Delivery is attempted through the original adapter.
5. Delivery metadata and logs are recorded.
6. The intake advances to quoted.

Rejection stores the decision and sends a price-free follow-up message.

## Manual invoices and contract proposals

The dashboard also supports manually constructed:

- Commercial invoices
- Contract proposals
- PDF exports

Manual invoices reuse quote-related tables but have separate numbering and statuses. Contract proposals have their own repository/table.

PDFs are generated on demand with PDFKit rather than stored as files.

---

# 10. Live conversations and human takeover

Relevant code:

```text
src/engine/conversations/conversation-service.ts
src/db/repositories/conversations.ts
src/server/conversation-routes.ts
dashboard/src/LiveConversations.tsx
```

Conversation modes are:

- `ai` — the agent answers.
- `human` — a named operator owns the conversation.
- `paused` — AI responses are disabled without an active operator.

The dashboard can:

- List live conversations.
- Inspect full message history.
- Pause the AI.
- Take over a conversation.
- Send operator replies through the original channel.
- Return the conversation to AI.
- Delete previously sent assistant/operator messages.

Inbound and outbound activity refreshes an idle deadline. The scheduler eventually closes inactive human/paused conversations and restores AI mode. A later inbound message can reopen the conversation.

---

# 11. Website lead path

Website form submissions use a distinct path from live chat:

```http
POST /api/leads
POST /api/intake/website
```

Both routes share validation and an IP-based rate limiter.

`recordWebsiteLead()` transactionally creates:

- A generated website session
- A summary user transcript message
- A completed intake
- A dashboard notification

Website leads therefore appear in the lead-management workflow without being normal live customer conversations. They also do not immediately follow the same automatic quote-generation trigger as chat intake.

---

# 12. HTTP API and authentication

The Express composition is in:

```text
src/server/app.ts
```

Additional routers cover:

- Pricing tables
- Quotes and approvals
- Contract proposals
- Live conversations

## Public endpoints

Examples include:

- Health check
- Login/logout
- Shared-secret channel ingress
- WhatsApp webhook handshake/receiver
- Rate-limited website lead submission

## Admin-protected endpoints

After the public routes, authentication middleware is mounted over the operational API:

- Dashboard summary
- Services and FAQs
- Support requests
- Sessions and transcripts
- Telemetry and traces
- Intake management
- Quotes and approvals
- Invoices and proposals
- Notifications
- Conversation controls
- Chat simulation

## Admin authentication

```text
src/auth/
```

Authentication uses:

- Salted scrypt password verification
- Random session tokens
- Hashed tokens stored in `admin_sessions`
- `HttpOnly`, `SameSite=Strict` session cookies
- Login lockout after repeated failures

All admins currently have equivalent operational access; there is no role/permission hierarchy.

---

# 13. Persistence architecture

The database abstraction is:

```text
src/db/database.ts
```

The `DB` interface exposes:

- `query()`
- `queryOne()`
- `exec()`
- `transaction()`
- `close()`
- Driver and redacted target metadata

This gives repositories one interface across two implementations.

## External PostgreSQL

For `postgres://` or `postgresql://` targets:

- Uses `pg.Pool`
- Supports a separate unpooled migration URL
- Runs migrations under a PostgreSQL advisory lock
- Normalizes hosted-provider SSL behavior
- Retries selected transient connection failures

## Embedded PGlite

For local paths or `:memory:`:

- Runs PostgreSQL-compatible storage inside the application process.
- Supports directory-backed development persistence.
- Uses in-memory PGlite for tests/eval.

## Migrations

```text
src/db/schema.sql
src/db/migrations/001_...sql through 011_...sql
```

Migration files are applied in filename order and tracked in `schema_migrations`.

The build explicitly copies the schema and migration assets into `dist/`, so the compiled runtime can execute migrations.

## Repositories

`src/db/repositories/` separates persistence by aggregate:

- Sessions
- Messages
- Traces
- Logs
- Requests
- Services and FAQs
- Intakes
- Price tables
- Quotes
- Settings
- Notifications
- Conversations
- Admin accounts
- Contract proposals

Multi-record aggregate operations use transactions where appropriate, such as:

- Price-table publication
- Quote/item creation
- Website lead creation
- Settings updates
- Pricing edits
- Protected service deletion

A whole customer turn is **not one giant transaction**, so transcript/log writes at different stages can persist independently.

---

# 14. Dashboard architecture

The dashboard is a separate npm package:

```text
dashboard/
├── src/App.tsx
├── src/api.ts
├── src/main.tsx
└── feature components
```

Stack:

- React
- TypeScript
- Vite
- React state/hooks
- Global CSS
- No router or external state-management library

`App.tsx` is the central shell. It:

- Checks the current admin session.
- Shows login when unauthenticated.
- Holds active-tab and global dashboard state.
- Loads summary, requests, logs, services, intakes, and approvals.
- Refreshes data every four seconds.
- Coordinates notification navigation and feature refreshes.

Major areas are:

1. Overview
2. Live Inbox
3. Leads & Intake
4. Invoice
5. Proposal
6. Catalog & Pricing
7. Telemetry & Logs

In development:

```text
React/Vite localhost:5173
        ↓ /api proxy
Express localhost:3001
```

For production, if `dashboard/dist` exists, Express serves it and falls back to `index.html` for non-API paths.

Freshness is based on **polling**, not WebSockets or server-sent events.

---

# 15. Configuration, build, and verification

Backend configuration is Zod-validated in:

```text
src/config/index.ts
```

It covers:

- HTTP/server behavior
- Database targets
- LLM and pricing providers/models
- Agent step/history limits
- Session TTL
- Channel credentials
- Admin session settings
- Quote margin and approval window
- Human-conversation idle timeout

Important scripts:

```bash
npm run dev             Backend source with watch mode
npm start               Backend source through tsx
npm run typecheck       Backend TypeScript check
npm test                Backend test suite
npm run build           Compile backend and copy SQL assets
npm run dashboard:dev   Start Vite dashboard
npm run dashboard:build Compile dashboard
npm run eval            Golden-conversation regression suite
npm run audit           Dependency security audit
```

Tests use in-memory PGlite and the mock provider, so live channel credentials and an external LLM are unnecessary.

The golden evaluator exercises representative conversations, including services, FAQs, support requests, intake, quoting, escalation, and human handback.

There is also an `e2e/` directory, but it is not part of the current standard npm scripts and appears to target older routes/data contracts, so it should not be treated as current end-to-end verification without updating it.

---

# 16. Architectural characteristics and limitations

The design is easiest to understand as a **single-tenant, single-process modular application**, not a distributed agent platform.

Notable consequences:

- **Tenant ID is contextual, not isolation.** Queries are generally global rather than scoped per tenant.
- **No external queue.** Reminders, idle sweeps, and delivery retries are mostly in-process/best-effort.
- **No per-session turn serialization.** Concurrent messages for one customer can potentially race.
- **Dashboard uses polling.** This is simple but produces repeated API work.
- **Session cache and rate-limit state are process-local.** Multiple replicas would not naturally share them.
- **Website and chat workflows intentionally differ.**
- **Escalation and conversation ownership are separate states.**
- **Stub sends can appear successful internally** even without external credentials.
- **There are two agent responsibilities:** conversational support and pricing selection. Price computation and approval remain deterministic/admin-controlled.
- **The main extension point for new business behavior is a tool plus repository/service logic**, not channel-specific intent handling.

The strongest architectural boundary is therefore:

```text
Transport-independent engine
+ validated business tools
+ repository-backed durable state
+ admin approval for commercial output
```
