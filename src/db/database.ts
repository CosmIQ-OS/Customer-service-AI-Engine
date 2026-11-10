import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type DB = Database.Database;

export function openDatabase(dbPath: string): DB {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  applyMigrations(db);
  return db;
}

function applyMigrations(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const directory = path.join(__dirname, 'migrations');
  if (!fs.existsSync(directory)) return;
  const applied = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>).map((row) => row.name),
  );
  const migrations = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();

  for (const name of migrations) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(directory, name), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
    })();
  }
}
