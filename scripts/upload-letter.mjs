import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hundredDayLetterKey, parseLetter } from '../worker/letter.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

try {
  if (args[0] !== '--config' || !['wrangler.preview.jsonc', 'wrangler.jsonc'].includes(args[1])
    || args.length > 3 || (args.length === 3 && args[2] !== '--check')) {
    throw new Error('请通过 letter:check 或 letter:upload:<环境> 运行。');
  }
  const configPath = join(root, args[1]);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const target = args[1] === 'wrangler.jsonc' ? 'loveuhqq-site' : 'loveuhqq-site-preview';
  if (config.name !== target || !config.kv_namespaces?.some(binding => binding.binding === 'PHOTOS' && binding.id)) {
    throw new Error('目标 Worker 或私密 KV 绑定无效。');
  }
  const source = join(root, '.private-letter', 'hundred-day.json');
  let value;
  try { value = JSON.parse(readFileSync(source, 'utf8')); }
  catch { throw new Error('请先准备 .private-letter/hundred-day.json（UTF-8 JSON）。'); }
  const letter = parseLetter(value);
  if (args[2] === '--check') {
    console.log(`信件格式检查通过：${letter.paragraphs.length} 段；未上传。`);
  } else {
    // Pass only the local file path; never put the body in command arguments or logs.
    const result = spawnSync(process.execPath, [join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
      'kv', 'key', 'put', hundredDayLetterKey, '--path', source, '--binding', 'PHOTOS', '--remote', '--config', configPath],
    { cwd: root, stdio: 'ignore', windowsHide: true, env: { ...process.env, WRANGLER_LOG_SANITIZE: 'true' } });
    if (result.status !== 0) throw new Error('上传失败，请检查项目 Wrangler 登录和目标权限；信件正文未回显。');
    console.log(`百日信已提交至 ${target} 的私密 KV；请继续验收权限和内容生效状态。`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
