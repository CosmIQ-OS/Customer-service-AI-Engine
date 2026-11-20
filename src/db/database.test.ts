import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { isPostgresUrl, openDatabase, redactDatabaseUrl, type DB } from './database.js';
import { migrateSqliteToPostgres } from '../cli/migrate-sqlite.js';

const databases: DB[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  while (databases.length) await databases.pop()?.close();
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('PostgreSQL database layer', () => {
  it('detects PostgreSQL URLs and redacts passwords before logging', () => {
    assert.equal(isPostgresUrl('postgresql://user:s3cr3t@ep-test.neon.tech/neondb?sslmode=require'), true);
    assert.equal(isPostgresUrl('postgres://user:s3cr3t@localhost:5432/app'), true);
    assert.equal(isPostgresUrl('./data/pglite'), false);
    assert.equal(isPostgresUrl(':memory:'), false);

    const redacted = redactDatabaseUrl('postgresql://neondb_owner:topsecretpassword@ep-abc.neon.tech/neondb?sslmode=require');
    assert.equal(redacted.includes('topsecretpassword'), false);
    assert.match(redacted, /ep-abc\.neon\.tech/);
  });

  it('applies all migrations idempotently across restarts on local PGlite storage', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmiq-pg-'));
    tempDirs.push(dir);
    const dataDir = path.join(dir, 'pglite');

    const first = await openDatabase(dataDir);
    assert.equal(first.driver, 'pglite');
    const migrations = await first.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
    assert.equal(migrations.rows.length, 11);
    assert.ok(migrations.rows.some((r) => r.name === '008_catalog_and_settings.sql'));
    assert.ok(migrations.rows.some((r) => r.name === '009_proposals_and_website_leads.sql'));
    assert.ok(migrations.rows.some((r) => r.name === '010_lead_status_and_workflow.sql'));
    assert.ok(migrations.rows.some((r) => r.name === '011_invoices_and_proposals.sql'));
    const basePriceCol = await first.queryOne<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'services' AND column_name = 'base_price_paise'`,
    );
    assert.equal(basePriceCol?.column_name, 'base_price_paise');
    await first.query("INSERT INTO services (name, status, base_price_paise) VALUES ('Persisted Service', 'available', 150000)");
    await first.close();

    const second = await openDatabase(dataDir);
    databases.push(second);
    const services = await second.query<{ name: string; base_price_paise: number }>('SELECT name, base_price_paise FROM services');
    assert.deepEqual(services.rows.map((r) => ({ name: r.name, base_price_paise: Number(r.base_price_paise) })), [
      { name: 'Persisted Service', base_price_paise: 150000 },
    ]);
  });

  it('rolls back transactions completely on failure', async () => {
    const db = await openDatabase(':memory:');
    databases.push(db);

    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO services (name, status) VALUES ('Should Rollback', 'available')");
        throw new Error('simulated failure');
      }),
      /simulated failure/,
    );

    const row = await db.queryOne<{ count: number }>('SELECT COUNT(*)::int AS count FROM services');
    assert.equal(row?.count, 0);
  });

  it('migrates an existing SQLite database into PostgreSQL idempotently and resets sequences', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmiq-sqlite-migrate-'));
    tempDirs.push(dir);
    const sqlitePath = path.join(dir, 'legacy.db');

    const { DatabaseSync } = await import('node:sqlite');
    const sqlite = new DatabaseSync(sqlitePath);
    try {
      sqlite.exec(`
        CREATE TABLE services (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'general',
          status TEXT NOT NULL DEFAULT 'available',
          availability_note TEXT NOT NULL DEFAULT '',
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT '2026-11-10 10:00:00',
          updated_at TEXT NOT NULL DEFAULT '2026-11-10 10:00:00'
        );
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          channel TEXT NOT NULL,
          external_user_id TEXT NOT NULL,
          context TEXT NOT NULL DEFAULT '{}',
          last_intent TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          expires_at TEXT,
          created_at TEXT NOT NULL DEFAULT '2026-11-10 10:00:00',
          updated_at TEXT NOT NULL DEFAULT '2026-11-10 10:00:00'
        );
        CREATE TABLE messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          external_user_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          tokens INTEGER NOT NULL DEFAULT 5,
          tenant_id TEXT NOT NULL DEFAULT 'default',
          created_at TEXT NOT NULL DEFAULT '2026-11-10 10:00:00'
        );
        INSERT INTO services (id, name, category, status) VALUES (10, 'WhatsApp Agent Services', 'whatsapp', 'available');
        INSERT INTO sessions (id, channel, external_user_id) VALUES ('sess-legacy', 'whatsapp', '919999999999');
        INSERT INTO messages (id, session_id, channel, external_user_id, role, content)
          VALUES (25, 'sess-legacy', 'whatsapp', '919999999999', 'user', 'Hello from SQLite');
      `);
    } finally {
      sqlite.close();
    }

    const pgDb = await openDatabase(':memory:');
    databases.push(pgDb);

    const firstRun = await migrateSqliteToPostgres(sqlitePath, pgDb);
    const serviceReport = firstRun.tables.find((t) => t.table === 'services');
    const messageReport = firstRun.tables.find((t) => t.table === 'messages');
    assert.equal(serviceReport?.insertedRows, 1);
    assert.equal(messageReport?.insertedRows, 1);

    // Re-running migration must be idempotent (0 duplicates inserted).
    const secondRun = await migrateSqliteToPostgres(sqlitePath, pgDb);
    assert.equal(secondRun.tables.find((t) => t.table === 'services')?.insertedRows, 0);
    assert.equal(secondRun.tables.find((t) => t.table === 'messages')?.targetRows, 1);

    // Sequences must be reset past MAX(id) so new inserts never collide.
    const nextService = await pgDb.queryOne<{ id: number }>(
      "INSERT INTO services (name, status) VALUES ('Post-Migration Service', 'available') RETURNING id",
    );
    assert.ok(Number(nextService!.id) > 10, `expected new service id > 10, got ${nextService?.id}`);
  });
});
