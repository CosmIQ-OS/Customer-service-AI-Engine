import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_LOCK_KEY = 842_910_371;

export const UTC_NOW_SQL = "to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface DBExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  exec(sql: string): Promise<void>;
}

export interface DB extends DBExecutor {
  transaction<T>(fn: (tx: DBExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly driver: 'pg' | 'pglite';
  readonly target: string;
}

export function isPostgresUrl(value: string): boolean {
  return /^postgres(?:ql)?:\/\//i.test(value.trim());
}

/** Masks credentials in a PostgreSQL URL before logging. */
export function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return 'postgres://***';
  }
}

/** Resolves a local PGlite directory, safely avoiding collisions with legacy SQLite files. */
function resolvePgliteTarget(target: string): { memory: true } | { memory: false; dir: string } {
  const trimmed = target.trim();
  if (!trimmed || trimmed === ':memory:') return { memory: true };
  const resolved = path.resolve(trimmed);
  const looksLikeLegacyFile =
    /\.(?:db|sqlite|sqlite3)$/i.test(resolved) ||
    (fs.existsSync(resolved) && fs.statSync(resolved).isFile());
  const dir = looksLikeLegacyFile ? path.join(path.dirname(resolved), 'pglite') : resolved;
  if (looksLikeLegacyFile) {
    console.log(`[db] Legacy SQLite path "${target}" redirected to local PostgreSQL (PGlite) directory "${dir}".`);
  }
  fs.mkdirSync(dir, { recursive: true });
  return { memory: false, dir };
}

export interface OpenDatabaseOptions {
  /** Direct (non-pooled) PostgreSQL URL for DDL schema migrations (Neon DATABASE_URL_UNPOOLED). */
  migrationUrl?: string;
}

/** Normalizes Neon/Postgres SSL params so pg verifies server certs cleanly without deprecation warnings. */
function normalizePgUrl(connectionString: string): { url: string; ssl?: { rejectUnauthorized: boolean } } {
  try {
    const parsed = new URL(connectionString);
    const mode = parsed.searchParams.get('sslmode')?.toLowerCase();
    if (mode === 'disable') {
      return { url: connectionString };
    }
    if (mode === 'require' || mode === 'prefer' || mode === 'verify-ca') {
      parsed.searchParams.set('sslmode', 'verify-full');
      return { url: parsed.toString() };
    }
    if (!mode && /neon\.tech|supabase\.co|render\.com|amazonaws\.com/i.test(parsed.hostname)) {
      parsed.searchParams.set('sslmode', 'verify-full');
      return { url: parsed.toString() };
    }
    return { url: connectionString };
  } catch {
    return { url: connectionString };
  }
}

async function openPgDatabase(connectionString: string, options: OpenDatabaseOptions = {}): Promise<DB> {
  const pgModule = await import('pg');
  const pg = pgModule.default ?? pgModule;

  // Parse PostgreSQL INT8 (BIGINT / COUNT) as JS numbers (safe up to 9e15, ~₹90 trillion in paise).
  pg.types.setTypeParser(20, (value: string) => Number(value));

  const createPool = (rawUrl: string, max: number) => {
    const normalized = normalizePgUrl(rawUrl);
    return new pg.Pool({
      connectionString: normalized.url,
      ssl: normalized.ssl,
      max,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 30_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
  };

  const makeExecutor = (runner: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> }): DBExecutor => ({
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const res = await runner.query(sql, params);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
    },
    async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      const res = await runner.query(sql, params);
      return res.rows[0] as T | undefined;
    },
    async exec(sql: string): Promise<void> {
      await runner.query(sql);
    },
  });

  const wrapPool = (pool: InstanceType<typeof pg.Pool>, url: string): DB => {
    pool.on('error', (err: Error) => {
      console.error('[db] Unexpected idle PostgreSQL client error:', err.message);
    });
    const base = makeExecutor(pool);
    return {
      ...base,
      driver: 'pg',
      target: redactDatabaseUrl(url),
      async transaction<T>(fn: (tx: DBExecutor) => Promise<T>): Promise<T> {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(makeExecutor(client));
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      },
      async close(): Promise<void> {
        await pool.end();
      },
    };
  };

  const db = wrapPool(createPool(connectionString, 10), connectionString);

  // Fast path: if all migrations are already applied, skip opening a second direct connection.
  if (await withConnectRetry(() => allMigrationsApplied(db))) {
    return db;
  }

  // Follow Neon best practice: run DDL schema migrations over the direct (unpooled) URL when available.
  const migrationUrl = options.migrationUrl?.trim();
  if (migrationUrl && isPostgresUrl(migrationUrl) && migrationUrl !== connectionString) {
    const migrationDb = wrapPool(createPool(migrationUrl, 2), migrationUrl);
    try {
      await withConnectRetry(() => applyMigrations(migrationDb, true));
    } finally {
      await migrationDb.close();
    }
    return db;
  }

  await withConnectRetry(() => applyMigrations(db, true));
  return db;
}

async function openPgliteDatabase(target: string): Promise<DB> {
  const { PGlite } = await import('@electric-sql/pglite');
  const resolved = resolvePgliteTarget(target);
  const pglite = resolved.memory ? await PGlite.create() : await PGlite.create(resolved.dir);

  const makeExecutor = (runner: {
    query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; affectedRows?: number }>;
    exec: (sql: string) => Promise<unknown>;
  }): DBExecutor => ({
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const res = await runner.query<T>(sql, params);
      return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
    },
    async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      const res = await runner.query<T>(sql, params);
      return res.rows[0];
    },
    async exec(sql: string): Promise<void> {
      await runner.exec(sql);
    },
  });

  const base = makeExecutor(pglite);

  const db: DB = {
    ...base,
    driver: 'pglite',
    target: resolved.memory ? 'pglite://:memory:' : `pglite://${resolved.dir}`,
    async transaction<T>(fn: (tx: DBExecutor) => Promise<T>): Promise<T> {
      return pglite.transaction(async (tx) => fn(makeExecutor(tx)));
    },
    async close(): Promise<void> {
      await pglite.close();
    },
  };

  await applyMigrations(db, false);
  return db;
}

/**
 * Opens a PostgreSQL database and applies any pending SQL migrations.
 *
 * - Pass a `postgres://` or `postgresql://` URL (e.g. Neon) to connect over TCP with pooling.
 * - Pass `:memory:` or a local directory path (e.g. `./data/pglite`) to run embedded PostgreSQL via PGlite.
 */
export async function openDatabase(target: string, options: OpenDatabaseOptions = {}): Promise<DB> {
  if (isPostgresUrl(target)) {
    return openPgDatabase(target.trim(), options);
  }
  return openPgliteDatabase(target);
}

async function withConnectRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const transient = /timeout|terminated|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(msg);
      if (!transient || attempt === attempts) throw error;
      console.warn(`[db] Transient PostgreSQL connect error (attempt ${attempt}/${attempts}): ${msg}. Retrying...`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function allMigrationsApplied(db: DBExecutor): Promise<boolean> {
  const directory = path.join(__dirname, 'migrations');
  if (!fs.existsSync(directory)) return false;
  const expected = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  if (expected.length === 0) return false;
  try {
    const { rows } = await db.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.name));
    return expected.every((name) => applied.has(name));
  } catch (error) {
    // 42P01 = undefined_table (fresh database before initial schema migration)
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '42P01') {
      return false;
    }
    throw error;
  }
}

async function applyMigrations(db: DB, useAdvisoryLock: boolean): Promise<void> {
  const run = async (executor: DBExecutor) => {
    await executor.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    await executor.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (${UTC_NOW_SQL})
    )`);

    const directory = path.join(__dirname, 'migrations');
    if (!fs.existsSync(directory)) return;
    const { rows } = await executor.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.name));
    const migrations = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();

    for (const name of migrations) {
      if (applied.has(name)) continue;
      const sql = fs.readFileSync(path.join(directory, name), 'utf8');
      if (useAdvisoryLock) {
        // Already inside a locked transaction on pg, or use savepoint per migration.
        await executor.exec(sql);
        await executor.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      } else {
        await db.transaction(async (tx) => {
          await tx.exec(sql);
          await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        });
      }
    }
  };

  if (useAdvisoryLock) {
    await db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
      await run(tx);
    });
  } else {
    await run(db);
  }
}
