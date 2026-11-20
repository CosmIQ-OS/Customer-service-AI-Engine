# Deployment and Live-Test Runbook

Operational guide for running the Business Support AI Engine, including live Telegram testing and Docker deployment.

---

## 1. Status snapshot

| Area | Status |
|---|---|
| AI agent loop, tools, intake, pricing, quotes | Ready |
| Approval queue and admin alerts | Ready |
| Live conversations (pause AI, take over, hand back) | Ready |
| Dashboard (logs, requests, services, intakes, quotes, inbox) | Ready |
| Telegram delivery (long polling, replies, operator alerts) | Ready for live tests |
| WhatsApp delivery (Cloud API outbound) | Outbound ready; inbound webhook verification not implemented |
| Docker image and Compose file | Written and statically checked; not built in this environment (no Docker daemon) |
| Unit tests / typecheck / eval / audit | Green (120 tests, 10/10 eval, 0 vulnerabilities) |

### Is it ready for live Telegram tests?

**Yes, for polling mode.** Once `TELEGRAM_BOT_TOKEN` is set, the adapter long-polls `getUpdates`, forwards messages to the engine, and sends replies through `sendMessage`. No public URL is required.

Two things to know before testing:

1. **Default AI is the mock provider.** It is deterministic and needs no key, but it is not a real language model. For a meaningful live test set `LLM_PROVIDER=openai-compatible` and `OPENAI_API_KEY`.
2. **Polling and webhooks are mutually exclusive.** If the bot previously had a webhook, Telegram returns `409 Conflict` and polling will not start. Remove the webhook first (step 6.4).

WhatsApp: outbound messages work with the Cloud API. Meta's inbound webhook verification (`GET` with `hub.challenge`) is **not** implemented, so inbound WhatsApp messages need an additional verification handler before live inbound testing.

---

## 2. Prerequisites

### Choose one runtime

**Local (Node.js)**
- Node.js 22+
- npm 10+
- Build tools for `better-sqlite3` if no prebuilt binary matches: `python3`, `make`, `g++`

**Docker**
- Docker Engine 24+
- Docker Compose v2 (`docker compose`)
- Build tools are installed inside the image, so the host does not need them

### Accounts and secrets

| Item | Required for | How to get it |
|---|---|---|
| Telegram bot token | Live Telegram | Message `@BotFather`, run `/newbot`, copy the token |
| Telegram admin chat id(s) | Operator alerts | Message `@userinfobot`, or read the chat id from an update |
| OpenAI-compatible API key | Real AI replies | Your provider's dashboard |
| Admin password | Dashboard login | Choose a 12–256 character password |

> The Telegram bot cannot start a conversation with a user. The user must message the bot first.

---

## 3. Configuration

Copy the template and edit it. **Never commit `.env`.**

```bash
cp .env.example .env
```

### Required for a basic local run

```dotenv
PORT=3001
DB_PATH=./data/pglite
LLM_PROVIDER=mock
```

### Required for Production on Render + Neon PostgreSQL (Free Tier Safe)

Render Free Tier containers have ephemeral disks that reset on restart/sleep. Connect a permanent free **Neon PostgreSQL** database:

1. Create a free project at <https://neon.tech> and copy the **Pooled connection string**.
2. In your Render Web Service → **Environment**, add:
   ```dotenv
   DATABASE_URL=postgresql://neondb_owner:<password>@<ep-host>-pooler.<region>.aws.neon.tech/neondb?sslmode=require
   COOKIE_SECURE=true
   ```
3. On first boot, the server automatically acquires a PostgreSQL advisory lock, creates the application tables, runs migrations `001`–`008`, and seeds CosmIQ services, FAQs, price tables, and the default admin account.
4. *(Optional)* To copy existing local SQLite data (`data/support.db`) into Neon safely:
   ```bash
   DATABASE_URL="postgresql://..." npm run db:migrate-sqlite -- ./data/support.db
   ```
   The script opens SQLite read-only, runs inside one atomic PostgreSQL transaction with `ON CONFLICT DO NOTHING`, resets all `SERIAL` sequences, and prints a row-count verification table.

### Required for a real live test

```dotenv
LLM_PROVIDER=openai-compatible
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=your-key
LLM_MODEL=gpt-4o-mini

TELEGRAM_BOT_TOKEN=123456:your-bot-token
TELEGRAM_ADMIN_CHAT_IDS=123456789
TELEGRAM_POLLING=true
```

### Other useful variables

| Variable | Default | Purpose |
|---|---|---|
| `DB_PATH` | `./data/support.db` | SQLite file. In Docker use `/app/data/support.db` |
| `SESSION_TTL_MINUTES` | `120` | Session context lifetime |
| `AGENT_MAX_STEPS` | `6` | Tool-call loop bound |
| `AGENT_MAX_HISTORY` | `12` | Transcript messages sent to the model |
| `AGENT_TEMPERATURE` | `0.2` | Model temperature |
| `CONVERSATION_IDLE_MINUTES` | `60` | Auto-close a human-owned chat after inactivity |
| `QUOTE_MARGIN_PERCENT` | `30` | Starting markup (30–35, editable in dashboard) |
| `QUOTE_APPROVAL_WINDOW_HOURS` | `6` | Approval reminder interval |
| `CHANNEL_WEBHOOK_SECRET` | empty | Shared secret for `POST /api/channels/:channel/inbound`; empty disables ingress |
| `COOKIE_SECURE` | `false` | Set `true` only when served over HTTPS |
| `CLOUDFLARE_TUNNEL_TOKEN` | empty | Only for the optional tunnel profile |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | empty | WhatsApp Cloud API delivery |

---

## 4. Local run (no Docker)

```bash
# 1. Install both packages (backend + dashboard)
npm run setup

# 2. Configure
cp .env.example .env
# edit .env

# 3. Create the first admin (password via stdin, never as an argument)
printf '%s' 'your-12-plus-char-password' | npm run admin:create -- admin "Admin Name"

# 4. Start the API
npm run dev

# 5. In a second terminal, start the dashboard (development mode)
npm run dashboard:dev
```

Open:

- Dashboard: `http://localhost:5173`
- API health: `http://localhost:3001/api/health`

To run the built dashboard from the API server instead:

```bash
npm run dashboard:build
npm run start          # serves dashboard/dist on http://localhost:3001
```

---

## 5. Docker deployment

### 5.1 Build and start

```bash
# from the repository root
cp .env.example .env
# edit .env: set DB_PATH=/app/data/support.db and your secrets

docker compose build
docker compose up -d
docker compose ps
docker compose logs -f engine
```

Open `http://localhost:3001`. The Compose file maps port `3001` to the host and stores the database in the `engine-data` volume.

### 5.2 Create the admin inside the container

The CLI reads the password from stdin, so use `-T` (no TTY) and a pipe:

```bash
printf '%s' 'your-12-plus-char-password' \
  | docker compose exec -T engine npm run admin:create -- admin "Admin Name"
```

Then sign in at `http://localhost:3001`.

### 5.3 Verify

```bash
curl -s http://localhost:3001/api/health
docker compose ps          # engine should be "healthy"
docker compose logs engine | tail -20
```

Expected log lines include the listening URL, DB path, LLM provider, and `[telegram] connected as @yourbot` when a token is configured.

### 5.4 Common operations

```bash
docker compose restart engine          # restart
docker compose pull && docker compose up -d --build   # update
docker compose down                    # stop (keeps the volume)
docker compose down -v                 # stop and delete data (destructive)
```

Back up the database:

```bash
docker compose exec -T engine \
  node -e "const D=require('better-sqlite3');new D('/app/data/support.db').backup('/app/data/backup.db').then(()=>console.log('ok'))"
docker compose cp engine:/app/data/backup.db ./support-backup.db
```

### 5.5 HTTPS with Cloudflare Tunnel

1. Create a tunnel in the Cloudflare dashboard and copy its token.
2. Add `CLOUDFLARE_TUNNEL_TOKEN=...` to `.env`.
3. Set `COOKIE_SECURE=true` in `.env`.
4. Point the tunnel's public hostname at `http://engine:3001`.
5. Start the tunnel profile:

```bash
docker compose --profile tunnel up -d
```

### 5.6 Docker notes

- The container runs as the unprivileged `app` user.
- The health check calls `/api/health` every 30 seconds.
- `npm start` runs the TypeScript sources through `tsx`, so `src/` must be present in the image (it is).
- Run a **single replica**. Telegram long polling with two replicas causes duplicate replies and `409` conflicts.

---

## 6. Live Telegram test, step by step

### 6.1 Create the bot

1. Open Telegram, message `@BotFather`.
2. Send `/newbot`, choose a name and a username ending in `bot`.
3. Copy the token (`123456789:AA...`).

### 6.2 Get your admin chat id

1. Message `@userinfobot`; it replies with your numeric id.
2. Put that number in `TELEGRAM_ADMIN_CHAT_IDS` (comma-separate multiple ids).
3. Send your bot a direct message at least once so it is allowed to reply to you.

### 6.3 Configure and restart

```dotenv
TELEGRAM_BOT_TOKEN=123456789:AA...
TELEGRAM_ADMIN_CHAT_IDS=123456789
TELEGRAM_POLLING=true
LLM_PROVIDER=openai-compatible
OPENAI_API_KEY=your-key
```

```bash
# local
npm run dev
# or docker
docker compose up -d --build && docker compose logs -f engine
```

Confirm the log shows `[telegram] connected as @yourbot`.

### 6.4 Remove any existing webhook (only if polling fails with 409)

Run without printing the token:

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook"
```

Then restart the app.

### 6.5 Test the flows

| Test | Send to the bot | Expected |
|---|---|---|
| Services | `What services are available?` | Reply listing services with status |
| FAQ | `What are your support hours?` | FAQ answer |
| Intake | `Company: Acme; Size: 40; Tools: Slack; Service: Workflow Automation` | Intake collected, quote queued |
| Human handoff | `I want to talk to a human` | Escalation logged; alert sent to admin chat |
| Takeover | Open dashboard, Live Conversations, Take over, send a reply | Customer receives the human reply; AI stays silent for the next customer message |
| Handback | Click Hand back to AI | AI answers the next customer message |
| Idle close | Leave a human-owned chat untouched for 60 minutes | Conversation closes automatically |

### 6.6 Confirm on the dashboard

- **Chat Logs** shows inbound/outbound/system events.
- **Live Conversations** shows the chat, ownership pill, and unread count.
- **Chat Requests** shows escalations and support requests.
- **Approval Queue** shows quotes waiting for admin approval; the admin Telegram chat also receives the alert.

### 6.7 Webhook mode (optional)

Polling is simplest. Webhook mode needs a public HTTPS URL and a secret:

```dotenv
TELEGRAM_POLLING=false
CHANNEL_WEBHOOK_SECRET=a-random-16-plus-char-secret
```

Register the webhook with Telegram (Telegram sends the secret back in the `X-Telegram-Bot-Api-Secret-Token` header; the current route validates `x-webhook-secret`, so put the same value in both places if your proxy maps it):

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://your-domain.example/api/channels/telegram/inbound" \
  -d "secret_token=${CHANNEL_WEBHOOK_SECRET}"
```

---

## 7. Verification checklist

Before declaring a live test successful:

- [ ] `/api/health` returns `{"ok":true}`
- [ ] Admin can sign in
- [ ] `docker compose ps` reports the engine as healthy
- [ ] Bot replies to a direct message
- [ ] Dashboard shows the conversation and logs
- [ ] Takeover suppresses AI replies
- [ ] Handback restores AI replies
- [ ] Quote approval alert reaches the admin Telegram chat
- [ ] Database volume survives `docker compose down` and restart

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `409 Conflict` in logs | A webhook is still registered | Run `deleteWebhook` (step 6.4), restart |
| Bot never replies | Wrong token, or bot not started | Check `[telegram] connected` log; verify token |
| `401` on every `/api` call | No admin session | Sign in; create an admin if none exists |
| Login succeeds but session drops | `COOKIE_SECURE=true` over plain HTTP | Set `COOKIE_SECURE=false` locally |
| `LLM_PROVIDER=openai-compatible` errors | Missing/invalid `OPENAI_API_KEY` | Set the key or use `LLM_PROVIDER=mock` |
| `SQLITE_CANTOPEN` in Docker | Volume permissions or wrong `DB_PATH` | Use `DB_PATH=/app/data/support.db`; recreate the volume |
| `better-sqlite3` build error | Missing compiler | Install `python3 make g++`, or use Docker |
| Dashboard blank at `:3001` | `dashboard/dist` not built | `npm run dashboard:build`, or use the Docker image |
| No operator alerts | `TELEGRAM_ADMIN_CHAT_IDS` empty or wrong | Set numeric chat ids; message the bot first |
| Duplicate replies | More than one replica polling | Run a single replica |

---

## 9. Security and operations

- Keep `.env` out of version control; it is gitignored.
- The bot token is never logged, stored in the database, or returned by the API. Error messages are redacted.
- Channel ingress is disabled unless `CHANNEL_WEBHOOK_SECRET` is set (16+ characters).
- All `/api` routes except health and sign-in require an admin session.
- Treat `data/*.db` as customer data: back it up encrypted and do not paste its contents into tickets or logs.
- Rotate the bot token in BotFather and the API key at the provider if either is exposed.
- `npm audit` currently reports 0 vulnerabilities; re-run it after dependency changes.

---

## 10. Invoice Ninja deployment

The invoice module uses the upstream **Invoice Ninja 5.13.56 Debian image**, not a fork. The Compose `invoicing` profile adds the official application architecture: PHP application, nginx, MySQL 8.4, Redis, and persistent volumes. The existing Node service communicates with nginx at `http://invoiceninja`; browsers only communicate with the Node API.

### 10.1 Configure

1. Copy `.env.example` to `.env` if needed and set a fresh, unique `APP_KEY`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `IN_USER_EMAIL`, and `IN_PASSWORD`. Do not reuse dashboard or database credentials and do not commit `.env`. The `invoicing` profile refuses to start while `DB_PASSWORD` or `DB_ROOT_PASSWORD` is blank, and `INVOICE_NINJA_BASE_URL` must be `http(s)` without embedded credentials.
2. Generate the Laravel key locally as `base64:` followed by 32 random bytes (for example, with `openssl rand -base64 32`). Keep a protected backup: losing `APP_KEY` makes encrypted Invoice Ninja data unrecoverable.
3. Configure a real SMTP provider and `MAIL_FROM_*` before using **Send Invoice**. `MAIL_MAILER=log` is only for local testing.
4. Start and inspect the profile:

   ```bash
   docker compose --profile invoicing up -d --build
   docker compose --profile invoicing ps
   docker compose --profile invoicing logs invoice-ninja-app
   ```

5. Open the Invoice Ninja administration UI at `http://localhost:8080`, complete its initial setup, and create a company API token. Put that token only in `INVOICE_NINJA_API_TOKEN` in `.env`, then restart `engine`.
6. In COSMIQ **Invoices → settings**, save company and payment details. These are stored in Invoice Ninja and included in newly generated invoice PDFs.

The administration port is bound to `127.0.0.1:8080` by default. Put the UI behind authenticated HTTPS before exposing it publicly. Invoice Ninja's client-facing branding/white-label use is subject to its own license.

### 10.2 Verify the integration

- `GET /api/health` and the dashboard login continue to work.
- Opening **Invoices** shows the list and settings icon; no browser requests contain the Invoice Ninja token.
- **New Invoice → Lead / intake** fills customer details and items from the latest approved quote. An existing customer uses the latest approved quote among that customer's linked leads.
- Saving creates one Invoice Ninja draft and a local customer/lead/quote/invoice relationship. Retrying the same request key returns the existing local invoice.
- **View** loads the upstream state and PDF preview; **PDF** downloads an authenticated PDF.
- **Send Invoice** requires a billing email and asks Invoice Ninja to email the invoice. Verify SMTP delivery separately in Invoice Ninja.
- Cancel/void maps to Invoice Ninja cancellation; archive is a separate operation. Paid invoices cannot be cancelled from this dashboard.
- Dashboard filters map draft to **Pending**, sent/partial to **Sent**, paid to **Paid**, and cancelled/archived/deleted to **Discarded**.

### 10.3 Storage and recovery

Back up both systems together:

- COSMIQ PostgreSQL/PGlite storage: customer and invoice links, item snapshots, status projections.
- `invoice-ninja-mysql`: authoritative clients, invoices, numbering, payments and ledger data.
- `invoice-ninja-storage` and `invoice-ninja-public`: documents and company files.

Do not delete volumes on upgrade. Pin and test upstream Invoice Ninja upgrades before changing `invoiceninja/invoiceninja-debian:5.13.56`. Docker/PHP are not required for Node unit tests: they use an in-memory database and Invoice Ninja test doubles without credentials or network access.
