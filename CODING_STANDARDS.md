# Coding Standards

Concise engineering standards for `customer-service-ai-engine` (backend `src/` + React `dashboard/`).

## TypeScript & Modules
- **Strict mode everywhere:** Run `npm run typecheck:all` (`src/`, `dashboard/`, `e2e/`, `eval/`) and `npm run lint` (Biome) before committing.
- **No new `any` leaks:** Prefer concrete interfaces, `unknown` with type narrowing, or Zod-inferred types over `: any` / `as any`.
- **NodeNext ESM:** Relative imports in `src/` must include the `.js` extension (e.g. `import { openDatabase } from './db/database.js'`).
- **No `@ts-ignore`:** Fix the underlying type mismatch rather than suppressing compiler checks.

## HTTP & Security Boundaries
- **Validate all inputs with Zod:** Parse request bodies, route IDs (positive `INT4` bounds `1..2_147_483_647`), and query limits (clamped `1..500`) before passing values to repositories.
- **Fail closed on missing secrets:** Public ingress endpoints (`/api/channels/:channel/inbound`, `/api/channels/whatsapp/webhook`) must return `503` when their secret is unconfigured and verify signatures/secrets with constant-time comparisons (`crypto.timingSafeEqual`).
- **Never commit fallback credentials:** Never hardcode default admin passwords, API keys, or tokens.
- **Prompt-injection boundary:** Keep untrusted customer free-text out of `role: 'system'` prompts; only pass structured non-freeform metadata in system messages.
- **External HTTP calls:** Always attach an `AbortSignal.timeout(...)` to outbound `fetch()` calls.

## Database & Concurrency
- **Migrations are append-only:** Never edit an already-applied file in `src/db/migrations/`. Add a new numbered migration instead.
- **Lock sequential generators:** Any `MAX(...) + 1` numbering or versioning inside a transaction must acquire a `pg_advisory_xact_lock(...)` first.
- **No unhandled fire-and-forget promises:** Every `void asyncFn()` call must attach `.catch(...)` and log the error.

## Frontend (`dashboard/`)
- **Never clear action errors from background polling:** Only reset error banners on explicit user actions or initial loads, and guard async polls with sequence counters or `AbortController`.
- **Encode dynamic URL segments:** Always wrap dynamic IDs (like `sessionId`) in `encodeURIComponent(...)`.
- **Clean up timers and streams:** Clear `setTimeout`, `setInterval`, and `EventSource` handles in `useEffect` cleanup functions.
