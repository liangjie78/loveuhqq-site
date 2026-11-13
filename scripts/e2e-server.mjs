/*
 * Starts an isolated local Worker for the end-to-end tests: a fresh D1/KV/DO
 * state under .wrangler/e2e-<port>, all migrations applied, and a test-only password
 * (E2E_PASSWORD, default below). Nothing here touches a remote environment.
 */
import { spawn, spawnSync } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const port = process.env.E2E_PORT ?? '8790';
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid test port.');
const parent = join(root, '.wrangler');
mkdirSync(parent, { recursive: true });
if (realpathSync(parent) !== parent) throw new Error('The test state must be inside the workspace under .wrangler.');
const state = join(parent, `e2e-${port}`);
if (existsSync(state) && realpathSync(state) !== state) throw new Error('The test state must use its own directory.');
rmSync(state, { recursive: true, force: true });
mkdirSync(state);
process.on('exit', () => {
  rmSync(state, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
const envFile = join(state, 'test.env');
const password = process.env.E2E_PASSWORD ?? 'e2e-only-password';
const wrangler = [`${root}/node_modules/wrangler/bin/wrangler.js`];

// An explicit env file keeps Wrangler from loading the workspace's development secrets.
const salt = randomBytes(16);
const hash = `pbkdf2$100000$${salt.toString('hex')}$${pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')}`;
writeFileSync(envFile, `EDITOR_PASSWORD_HASH=${hash.replaceAll('$', '\\$')}\n`);
const local = ['--local', '--config', 'wrangler.preview.jsonc', '--persist-to', state, '--env-file', envFile];
const env = { ...process.env, CI: '1', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'true', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false', WRANGLER_SEND_METRICS: 'false' };
const migrate = spawnSync(process.execPath, [...wrangler, 'd1', 'migrations', 'apply', 'loveuhqq-notebook-preview', ...local],
  { cwd: root, stdio: 'inherit', env });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const server = spawn(process.execPath, [...wrangler, 'dev', ...local,
  '--ip', '127.0.0.1', '--port', port, '--show-interactive-dev-session=false'],
{ cwd: root, stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', code => process.exit(code ?? 0));
