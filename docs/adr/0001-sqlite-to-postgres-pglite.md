# ADR 0001: Migrate Storage from SQLite to PostgreSQL (Neon) with PGlite Fallback

- **Status:** Accepted
- **Date:** 2026-04 (retroactively documented during onboarding audit)

## Context
The engine originally used local SQLite (`data/*.db`), which caused ephemeral data loss on Render Free Tier container restarts and could not scale across multiple instances. At the same time, local development, unit tests (`npm test`), and golden conversation evals (`npm run eval`) must remain zero-config and credential-free.

## Decision
1. Adopt **PostgreSQL** (`pg` pool) as the primary production database via `DATABASE_URL` (Neon pooled endpoint for runtime queries) and `DATABASE_URL_UNPOOLED` (direct endpoint for DDL migrations).
2. Use **`@electric-sql/pglite`** (embedded PostgreSQL WASM) as the automatic fallback when `DATABASE_URL` is unset (persisted to `DB_PATH` locally, or `:memory:` in tests and evals).
3. Fail fast on Render (`process.env.RENDER && !config.DATABASE_URL`) so production never silently falls back to ephemeral/RAM-heavy PGlite.
4. Keep a unified `DB` / `DBExecutor` abstraction in `src/db/database.ts` with `$1, $2, ...` positional parameters and `pg_advisory_xact_lock` for concurrency-safe numbering.

## Consequences
- **Positive:** Identical PostgreSQL dialect in local dev, tests, evals, and production; persistent cloud storage on Render Free Tier.
- **Trade-offs:** PGlite WASM startup adds per-database initialization overhead in tests (tests should reuse or minimize DB instances where possible); SQL migrations must be valid PostgreSQL DDL and remain append-only.
