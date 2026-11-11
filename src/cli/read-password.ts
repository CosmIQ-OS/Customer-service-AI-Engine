import readline from 'node:readline';

/** Reads the admin password from ADMIN_PASSWORD or stdin, never as a terminal argument. */
export async function readPassword(commandName = 'admin:create'): Promise<string> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (process.stdin.isTTY) {
    throw new Error(
      'Provide the password without typing it into the terminal, for example: ' +
        `read -s ADMIN_PASSWORD && export ADMIN_PASSWORD && npm run ${commandName} -- <username>`,
    );
  }
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line;
  }
  return '';
}
