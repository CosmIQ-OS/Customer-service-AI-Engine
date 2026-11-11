import 'dotenv/config';
import { AdminAuth } from '../auth/admin-auth.js';
import { loadConfig } from '../config/index.js';
import { openDatabase } from '../db/database.js';
import { readPassword } from './read-password.js';

async function main(): Promise<void> {
  const [username] = process.argv.slice(2);
  if (!username) {
    console.error('Usage: npm run admin:passwd -- <username>');
    process.exit(1);
  }

  const config = loadConfig();
  const db = openDatabase(config.DB_PATH);
  try {
    const auth = new AdminAuth(db, { sessionHours: config.ADMIN_SESSION_HOURS });
    const password = await readPassword('admin:passwd');
    await auth.setPassword(username, password);
    console.log(`Password updated for admin "${username}". Existing sessions were signed out.`);
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
