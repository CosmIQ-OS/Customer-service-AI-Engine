# Project Instructions

## Required build cycle

Any request to **build**, **ship**, **verify**, or **run the full cycle** must follow this order. Launch the named phase agents through `subagent`; do not replace their phases with manual checks.

1. **Implement** the minimal scoped change.
2. **App tests** — `app-tester`: `npm test` and `npm run typecheck`.
3. **Compile** — `npm run build`.
4. **Browser tests** — `browser-tester`: start the app and drive dashboard + API with Playwright.
5. **Eval** — `eval-runner`: `npm run eval`; a golden-conversation regression is a hard stop.
6. **Security** — `security-fixer`: dependency/static-analysis scans, fixes, and re-verification.
7. **Final verification** — confirm every phase is green and summarize.

If a phase fails, fix the root cause and restart at that phase. Never skip a red gate or mark the build done with red tests, compile, eval, or security scans. Commit only after every phase is green, if the directory is a git repository. `/build` runs the full cycle through `build-orchestrator`; `/test`, `/browser-test`, `/eval`, and `/scan` run individual phases.

## Commands

- Install both packages: `npm run setup` (root backend and `dashboard/` are separate npm packages, not workspaces).
- Backend dev server: `npm run dev` — tsx watch, port `3001` by default.
- Backend without watch: `npm start`.
- Dashboard dev server: `npm run dashboard:dev` — Vite on `5173`, proxying `/api` to `3001`.
- Focused checks: `npm run typecheck`, `npm test`, `npm run eval`, `npm run dashboard:build`.
- One test file: `npx tsx --test src/engine/support-engine.test.ts`.
- Security audit: `npm run audit`.

The root test script explicitly enumerates `src/config`, `src/engine`, and `src/llm`; update it when tests are added in another directory. Root typecheck/build exclude both `dashboard/` and `eval/`, so they do not replace the dashboard build or eval runner.

## Runtime and architecture

- `src/index.ts` is the composition root: loads `.env`, opens SQLite, constructs the LLM provider and `SupportEngine`, registers adapters, seeds empty databases, and starts Express.
- Request flow: `src/server/app.ts` or a channel adapter -> `SupportEngine.handleMessage()` -> `kernel/agent-loop.ts` -> tools in `src/tools/` -> repositories in `src/db/repositories/`.
- Business capabilities belong in tools registered by `src/tools/index.ts`; do not bypass the agent with intent regexes or repository calls in channel adapters.
- The default `LLM_PROVIDER=mock` is deterministic and needs no credentials. `openai` is an accepted alias for `openai-compatible`; live mode requires `OPENAI_API_KEY`.
- Unit tests and `npm run eval` use in-memory SQLite and the mock provider. They need no API key, network LLM, or running server. Eval cases live in `eval/golden-conversations.json`.
- Telegram delivers through the Bot API when `TELEGRAM_BOT_TOKEN` is set (long polling via `getUpdates`, replies via `sendMessage`, operator alerts to `TELEGRAM_ADMIN_CHAT_IDS`); WhatsApp delivers through the Cloud API when `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are set. Without those credentials both adapters stay in stub mode. Bot tokens are never logged, returned in API responses, or stored in the database.

## TypeScript and SQLite gotchas

- Use NodeNext ESM imports: relative TypeScript imports include the `.js` extension.
- `openDatabase()` always executes `src/db/schema.sql`, then applies unapplied files from `src/db/migrations/` in filename order, tracked in `schema_migrations`.
- For changes to existing databases, add a new ordered migration instead of editing an already-applied migration. Tests can use `openDatabase(':memory:')`.
- `npm run build` emits JavaScript to `dist/` but does not copy `schema.sql` or migration assets. Use `npm run dev`/`npm start` (both execute `src/` through tsx) unless asset copying is added; do not assume `node dist/index.js` works.
- `.env` is loaded only by the backend entrypoint and is gitignored. See "Secrets and data" below.

## Secrets and data

- Never open, print, copy, or summarize `.env`. It holds live credentials. Use `.env.example` to learn variable names and defaults.
- Do not run commands that dump the environment or secrets (`env`, `printenv`, `cat .env`, `grep` on `.env`).
- Never put real keys or tokens in source, tests, fixtures, docs, logs, error messages, or the dashboard.
- Tests and `npm run eval` must run without `.env` and without `OPENAI_API_KEY`.
- Treat `data/*.db` as customer data. Do not paste its contents into output, logs, or fixtures.
- If a secret appears in output or a file, stop, do not repeat it, and tell the user to rotate it.

Always ask question to clarify and get correct info before building.

VEry high specifics need not to be asked, as it can be configured later