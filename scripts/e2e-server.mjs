/*
 * Starts an isolated local Worker for the end-to-end tests: a fresh D1/KV/DO
 * state under .wrangler/e2e, all migrations applied, and a test-only password
 * (E2E_PASSWORD, default below). Nothing here touches a remote environment.
 */
import { spawn, spawnSync } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const state = '.wrangler/e2e';
const port = process.env.E2E_PORT ?? '8790';
const password = process.env.E2E_PASSWORD ?? 'e2e-only-password';
const wrangler = [`${root}/node_modules/wrangler/bin/wrangler.js`];

rmSync(`${root}/${state}`, { recursive: true, force: true });
const migrate = spawnSync(process.execPath, [...wrangler, 'd1', 'migrations', 'apply', 'loveuhqq-notebook-preview', '--local', '--config', 'wrangler.preview.jsonc', '--persist-to', state],
  { cwd: root, stdio: 'inherit', env: { ...process.env, CI: '1' } });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const salt = randomBytes(16);
const hash = `pbkdf2$100000$${salt.toString('hex')}$${pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')}`;
const server = spawn(process.execPath, [...wrangler, 'dev', '--local', '--config', 'wrangler.preview.jsonc', '--persist-to', state,
  '--ip', '127.0.0.1', '--port', port, '--var', `EDITOR_PASSWORD_HASH:${hash}`, '--show-interactive-dev-session=false'],
{ cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', code => process.exit(code ?? 0));
