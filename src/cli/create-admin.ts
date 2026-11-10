import 'dotenv/config';
import readline from 'node:readline';
import { AdminAuth } from '../auth/admin-auth.js';
import { loadConfig } from '../config/index.js';
import { openDatabase } from '../db/database.js';

async function readPassword(): Promise<string> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (process.stdin.isTTY) {
    throw new Error(
      'Provide the password without typing it into the terminal, for example: ' +
        'read -s ADMIN_PASSWORD && export ADMIN_PASSWORD && npm run admin:create -- <username>',
    );
  }
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line;
  }
  return '';
}

async function main(): Promise<void> {
  const [username, ...rest] = process.argv.slice(2);
  if (!username) {
    console.error('Usage: npm run admin:create -- <username> [display name]');
    process.exit(1);
  }

  const config = loadConfig();
  const db = openDatabase(config.DB_PATH);
  try {
    const auth = new AdminAuth(db, { sessionHours: config.ADMIN_SESSION_HOURS });
    const password = await readPassword();
    const admin = await auth.createAdmin(username, password, rest.join(' '));
    console.log(`Created admin "${admin.username}".`);
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
