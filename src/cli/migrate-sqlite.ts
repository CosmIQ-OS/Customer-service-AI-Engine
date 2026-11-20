import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveDatabaseTarget } from '../config/index.js';
import { openDatabase, type DB } from '../db/database.js';

interface TableSpec {
  name: string;
  hasSerialId: boolean;
}

/** Ordered topologically so parent rows always exist before child foreign keys. */
const TABLES: TableSpec[] = [
  { name: 'services', hasSerialId: true },
  { name: 'faqs', hasSerialId: true },
  { name: 'admin_users', hasSerialId: true },
  { name: 'admin_sessions', hasSerialId: false },
  { name: 'sessions', hasSerialId: false },
  { name: 'chat_requests', hasSerialId: true },
  { name: 'chat_logs', hasSerialId: true },
  { name: 'messages', hasSerialId: true },
  { name: 'traces', hasSerialId: true },
  { name: 'price_tables', hasSerialId: true },
  { name: 'price_items', hasSerialId: true },
  { name: 'service_intakes', hasSerialId: true },
  { name: 'app_settings', hasSerialId: false },
  { name: 'quotes', hasSerialId: true },
  { name: 'quote_items', hasSerialId: true },
  { name: 'admin_notifications', hasSerialId: true },
  { name: 'conversations', hasSerialId: false },
];

export interface TableMigrationReport {
  table: string;
  sourceRows: number;
  insertedRows: number;
  targetRows: number;
}

export interface MigrationReport {
  sourcePath: string;
  target: string;
  tables: TableMigrationReport[];
}

/**
 * Safely copies all data from an existing SQLite database into PostgreSQL (Neon or PGlite).
 *
 * - Opens SQLite in read-only mode so the source file is never modified.
 * - Executes inside a single PostgreSQL transaction (all-or-nothing).
 * - Uses ON CONFLICT DO NOTHING so re-runs are idempotent.
 * - Resets every PostgreSQL SERIAL sequence to MAX(id) after import.
 */
export async function migrateSqliteToPostgres(sqlitePath: string, targetDb: DB): Promise<MigrationReport> {
  const resolvedSource = path.resolve(sqlitePath);
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`SQLite source file not found: ${resolvedSource}`);
  }

  // Node 22 built-in SQLite reader — avoids requiring native C++ bindings in production.
  const { DatabaseSync } = await import('node:sqlite');
  const sqlite = new DatabaseSync(resolvedSource, { readOnly: true });

  try {
    const existingTables = new Set(
      (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    );

    const reports: TableMigrationReport[] = [];

    await targetDb.transaction(async (tx) => {
      for (const spec of TABLES) {
        if (!existingTables.has(spec.name)) {
          const countRow = await tx.queryOne<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${spec.name}`);
          reports.push({ table: spec.name, sourceRows: 0, insertedRows: 0, targetRows: Number(countRow?.count ?? 0) });
          continue;
        }

        const rows = sqlite.prepare(`SELECT * FROM ${spec.name}`).all() as Array<Record<string, unknown>>;
        let inserted = 0;

        for (const row of rows) {
          const columns = Object.keys(row);
          if (columns.length === 0) continue;
          const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
          const values = columns.map((col) => {
            const val = row[col];
            return val === undefined ? null : val;
          });
          const res = await tx.query(
            `INSERT INTO ${spec.name} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
            values,
          );
          inserted += res.rowCount;
        }

        if (spec.hasSerialId) {
          const stats = await tx.queryOne<{ max_id: number; total: number }>(
            `SELECT COALESCE(MAX(id), 1)::bigint AS max_id, COUNT(*)::int AS total FROM ${spec.name}`,
          );
          const maxId = Number(stats?.max_id ?? 1);
          const hasRows = Number(stats?.total ?? 0) > 0;
          await tx.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), $2, $3)`, [spec.name, maxId, hasRows]);
        }

        const countRow = await tx.queryOne<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${spec.name}`);
        reports.push({
          table: spec.name,
          sourceRows: rows.length,
          insertedRows: inserted,
          targetRows: Number(countRow?.count ?? 0),
        });
      }
    });

    return {
      sourcePath: resolvedSource,
      target: targetDb.target,
      tables: reports,
    };
  } finally {
    sqlite.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sqlitePath = args[0] ?? './data/support.db';
  const targetOverride = args[1];

  const config = loadConfig();
  // Prefer direct (unpooled) connection for bulk migrations/sequence updates per Neon best practices.
  const target = targetOverride ?? config.DATABASE_URL_UNPOOLED ?? resolveDatabaseTarget(config);
  const db = await openDatabase(target);
  try {
    console.log(`[migrate] Source SQLite : ${path.resolve(sqlitePath)}`);
    console.log(`[migrate] Target Postgres: ${db.driver} (${db.target})`);
    const report = await migrateSqliteToPostgres(sqlitePath, db);
    console.log('\nTable Migration Summary:');
    console.log('---------------------------------------------------------------');
    console.log('Table'.padEnd(24) + 'Source'.padStart(10) + 'Inserted'.padStart(12) + 'Target Total'.padStart(15));
    console.log('---------------------------------------------------------------');
    for (const row of report.tables) {
      console.log(
        row.table.padEnd(24) +
          String(row.sourceRows).padStart(10) +
          String(row.insertedRows).padStart(12) +
          String(row.targetRows).padStart(15),
      );
    }
    console.log('---------------------------------------------------------------');
    console.log('[migrate] Migration completed successfully!');
  } finally {
    await db.close();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error: unknown) => {
    console.error('[migrate] Failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
