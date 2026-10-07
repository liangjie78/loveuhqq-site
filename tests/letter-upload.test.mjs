import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('letter uploader checks offline and passes only the private file to the selected Wrangler target', (t) => {
  // Isolate the real uploader from credentials and the network with a fake Wrangler.
  const root = mkdtempSync(join(tmpdir(), 'loveuhqq-letter-upload-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts', 'worker', '.private-letter', 'node_modules/wrangler/bin']) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  copyFileSync(new URL('../scripts/upload-letter.mjs', import.meta.url), join(root, 'scripts/upload-letter.mjs'));
  copyFileSync(new URL('../worker/letter.ts', import.meta.url), join(root, 'worker/letter.ts'));
  const record = join(root, 'invocation.json');
  writeFileSync(join(root, 'node_modules/wrangler/bin/wrangler.js'), `import { writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), sanitize: process.env.WRANGLER_LOG_SANITIZE }));
    console.log('fake CLI output must stay hidden');`);
  for (const [config, name, id] of [['wrangler.preview.jsonc', 'loveuhqq-site-preview', 'preview-test'], ['wrangler.jsonc', 'loveuhqq-site', 'production-test']]) {
    writeFileSync(join(root, config), JSON.stringify({ name, kv_namespaces: [{ binding: 'PHOTOS', id }] }));
  }
  const source = join(root, '.private-letter/hundred-day.json');
  const letter = { salutation: 'Test', paragraphs: ['SYNTHETIC_PRIVATE_TEXT'], closing: '' };
  writeFileSync(source, JSON.stringify(letter));
  const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts/upload-letter.mjs'), ...args], { encoding: 'utf8' });
  const check = run('--config', 'wrangler.preview.jsonc', '--check');
  assert.equal(check.status, 0, check.stderr);
  assert.equal(existsSync(record), false, 'format checks must never invoke Wrangler');
  assert.ok(!check.stdout.includes(letter.paragraphs[0]));
  for (const config of ['wrangler.preview.jsonc', 'wrangler.jsonc']) {
    const upload = run('--config', config);
    assert.equal(upload.status, 0, upload.stderr);
    const invocation = JSON.parse(readFileSync(record, 'utf8'));
    assert.deepEqual(invocation.args, ['kv', 'key', 'put', 'letters/hundred-day.json', '--path', source,
      '--binding', 'PHOTOS', '--remote', '--config', join(root, config)]);
    assert.equal(invocation.sanitize, 'true');
    assert.ok(!upload.stdout.includes(letter.paragraphs[0]));
    assert.ok(!upload.stdout.includes('fake CLI'));
  }
  rmSync(record);
  writeFileSync(source, '{invalid SYNTHETIC_PRIVATE_TEXT');
  const invalid = run('--config', 'wrangler.jsonc');
  assert.equal(invalid.status, 1);
  assert.equal(existsSync(record), false, 'invalid private content must never be uploaded');
  assert.ok(!invalid.stderr.includes(letter.paragraphs[0]));
  assert.equal(run('--config', 'other.jsonc').status, 1);
});
