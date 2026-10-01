import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { emitKeypressEvents } from 'node:readline';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function hiddenInput(prompt) {
  return new Promise((resolveInput, reject) => {
    let value = '';
    process.stdout.write(prompt);
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) { value = ''; reject(error); }
      else resolveInput(value);
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && ['c', 'd'].includes(key.name)) return finish(new Error('已取消。'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { value = Array.from(value).slice(0, -1).join(''); return; }
      if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text)) {
        value += text;
        if (value.length > 128) finish(new Error('密码最多 128 个字符，请重新运行。'));
      }
    };
    process.stdin.on('keypress', onKey);
  });
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--config') throw new Error('用法：node scripts/set-editor-password.mjs --config <明确指定的 Wrangler 配置>');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('请在交互式终端运行，密码输入会隐藏。');
  const config = resolve(process.cwd(), process.argv[3]);
  const wrangler = resolve(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  await Promise.all([access(config), access(wrangler)]);
  let password = await hiddenInput('输入编辑密码（6–128 个字符，输入隐藏）：');
  if (password.length < 6) throw new Error('密码至少需要 6 个字符。');
  let confirmation = await hiddenInput('再次输入编辑密码：');
  if (confirmation !== password) { password = ''; confirmation = ''; throw new Error('两次密码不一致。'); }
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
  password = ''; confirmation = '';
  const secret = `pbkdf2$100000$${salt.toString('hex')}$${derived.toString('hex')}`;
  derived.fill(0);
  await new Promise((resolvePut, reject) => {
    const child = spawn(process.execPath, [wrangler, 'secret', 'put', 'EDITOR_PASSWORD_HASH', '--config', config],
      { cwd: root, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    child.once('error', () => reject(new Error('无法启动项目 Wrangler。')));
    child.stdin.on('error', () => reject(new Error('无法提交密码配置。')));
    child.once('close', (code) => code === 0 ? resolvePut() : reject(new Error('密码配置失败；请确认 Wrangler 已登录及目标 Worker 已创建。')));
    child.stdin.end(`${secret}\n`);
  });
  process.stdout.write('编辑密码已配置完成。\n');
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
