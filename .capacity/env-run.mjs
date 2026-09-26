// Capacity: run a command with the variables of an env file, the way upstream's
// `bun --env-file=<file> <cmd>` does. `node --env-file` cannot be used for the
// Next.js dev server: Next forwards node's exec flags to its child through
// NODE_OPTIONS, where --env-file is refused ("--env-file= is not allowed in
// NODE_OPTIONS"). Usage: node env-run.mjs <env file> <command> [args...]
import { spawn } from 'node:child_process';

const [envFile, command, ...args] = process.argv.slice(2);
if (!envFile || !command) {
  console.error('usage: node env-run.mjs <env file> <command> [args...]');
  process.exit(2);
}
try {
  process.loadEnvFile(envFile);
} catch (error) {
  console.error(`env-run: cannot load ${envFile}: ${error.message}`);
  process.exit(2);
}
const child = spawn(command === 'node' ? process.execPath : command, args, {
  stdio: 'inherit',
  env: process.env,
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
child.on('error', (error) => {
  console.error(`env-run: ${error.message}`);
  process.exit(1);
});
