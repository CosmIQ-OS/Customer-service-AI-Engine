# Project Instructions

## Required build cycle

Any request to **build**, **ship**, **verify**, or **run the full cycle** must follow this order. Launch the named phase agents through `subagent`; do not replace their phases with manual checks.

1. **Implement** the minimal scoped change.
2. **App tests** — `app-tester`: `npm test`, `npm run typecheck:all`, and `npm run lint`.
3. **Compile** — `npm run build` and `npm run dashboard:build`.
4. **Browser tests** — `browser-tester`: start the app and drive dashboard + API with Playwright.
5. **Eval** — `eval-runner`: `npm run eval`; a golden-conversation regression is a hard stop.
6. **Security** — `security-fixer`: dependency/static-analysis scans, fixes, and re-verification.
7. **Final verification** — confirm every phase is green and summarize.

If a phase fails, fix the root cause and restart at that phase. Never skip a red gate or mark the build done with red tests, compile, eval, or security scans. Commit only after every phase is green, if the directory is a git repository. `/build` runs the full cycle through `build-orchestrator`; `/test`, `/browser-test`, `/eval`, and `/scan` run individual phases.

## Commands

- Install both packages: `npm run setup` (root backend and `dashboard/` are separate npm packages, not workspaces).
- Install local git hooks: `npm run hooks:install` (enables `.githooks/pre-commit` running `typecheck:all` + `lint`).
- Backend dev server: `npm run dev` — tsx watch, port `3001` by default.
- Backend without watch: `npm start` (source via tsx) or `npm run start:prod` (compiled `dist/index.js`).
- Dashboard dev server: `npm run dashboard:dev` — Vite on `5173`, proxying `/api` to `3001`.
- Focused checks: `npm run typecheck:all`, `npm run lint`, `npm test`, `npm run eval`, `npm run build`, `npm run dashboard:build`.
- One test file: `npx tsx --test src/engine/support-engine.test.ts`.
- Security audit: `npm run audit`.

The root `test` script explicitly enumerates test directories in `package.json`; update it when tests are added in a new directory.

## Runtime and architecture

- `src/index.ts` is the composition root: loads `.env`, opens PostgreSQL (Neon via `DATABASE_URL` or embedded PGlite via `DB_PATH`), constructs the LLM provider and `SupportEngine`, registers adapters, seeds default catalog/FAQs/price tables, and starts Express.
- Request flow: `src/server/app.ts` or a channel adapter -> `SupportEngine.handleMessage()` -> `kernel/agent-loop.ts` -> tools in `src/tools/` -> repositories in `src/db/repositories/`.
- Business capabilities belong in tools registered by `src/tools/index.ts`; do not bypass the agent with intent regexes or repository calls in channel adapters.
- The default `LLM_PROVIDER=mock` is deterministic and needs no credentials. `openai` is an accepted alias for `openai-compatible`; live mode requires `OPENAI_API_KEY`.
- Unit tests and `npm run eval` use in-memory PGlite (`openDatabase(':memory:')`) and the mock provider. They need no API key, network LLM, or running server. Eval cases live in `eval/golden-conversations.json`.
- Telegram delivers through the Bot API when `TELEGRAM_BOT_TOKEN` is set (long polling via `getUpdates`, replies via `sendMessage`, operator alerts to `TELEGRAM_ADMIN_CHAT_IDS`); WhatsApp delivers through the Cloud API when `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are set, and `POST /api/channels/whatsapp/webhook` requires `WHATSAPP_APP_SECRET` (`X-Hub-Signature-256` HMAC verification, failing closed with `503` when unset). Bot tokens and secrets are never logged, returned in API responses, or stored in the database.

## TypeScript and PostgreSQL gotchas

- Use NodeNext ESM imports: relative TypeScript imports in `src/` include the `.js` extension.
- `openDatabase()` executes `src/db/schema.sql`, then applies unapplied files from `src/db/migrations/` in filename order, tracked in `schema_migrations`.
- For changes to existing databases, add a new ordered migration instead of editing an already-applied migration. Tests can use `openDatabase(':memory:')` (in-memory PGlite).
- `npm run build` compiles `src/` to `dist/` and copies `src/db/schema.sql` and `src/db/migrations/` into `dist/db/`.
- `.env` is loaded only by the backend entrypoint and is gitignored. See "Secrets and data" below.

## Secrets and data

- Never open, print, copy, or summarize `.env`. It holds live credentials. Use `.env.example` to learn variable names and defaults.
- Do not run commands that dump the environment or secrets (`env`, `printenv`, `cat .env`, `grep` on `.env`).
- Never put real keys, tokens, or fallback passwords in source, tests, fixtures, docs, logs, error messages, or the dashboard.
- Tests and `npm run eval` must run without `.env` and without `OPENAI_API_KEY`.
- Treat `data/` as customer data. Do not paste its contents into output, logs, or fixtures.
- If a secret appears in output or a file, stop, do not repeat it, and tell the user to rotate it.

## Clarification habit

Always ask clarifying questions to confirm intent before building non-trivial changes. Very granular specifics do not need to be asked up front when they can be configured later.
