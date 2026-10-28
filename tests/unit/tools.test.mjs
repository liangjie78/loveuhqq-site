// The maintenance scripts that move private photos and the letter into storage.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestUpsertSql, parseArgs } from '../../scripts/upload-photos.mjs';
import { exifDate, photoId } from '../../scripts/prepare-photos.mjs';
import { parseLetter } from '../../worker/letter.ts';

describe('photo upload script', () => {
  test('the manifest SQL survives quotes, emoji and large albums when replayed into SQLite', () => {
    const photos = Array.from({ length: 900 }, (_, index) => ({ id: index.toString(16).padStart(16, '0'), title: `它's 第${index}张 🌊`, date: '2026-08-15', width: 800, height: 600 }));
    const manifest = { version: 1, revision: 7, featured: [photos[0].id], photos };
    const sql = manifestUpsertSql(manifest);
    assert.ok(sql.split('\n').every(line => Buffer.byteLength(line) < 100_000), 'every statement fits D1');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE photo_manifest (id INTEGER PRIMARY KEY CHECK (id = 1), manifest TEXT NOT NULL, revision INTEGER NOT NULL);');
    db.exec(sql);
    const row = db.prepare('SELECT manifest, revision FROM photo_manifest').get();
    assert.deepEqual(JSON.parse(row.manifest).photos.at(-1).title, `它's 第899张 🌊`);
    db.exec(sql);
    assert.equal(db.prepare('SELECT revision FROM photo_manifest').get().revision, 8, 'a re-upload bumps the revision');
  });

  test('arguments are strict, and --persist-to only makes sense locally', () => {
    assert.deepEqual(parseArgs(['--config', 'wrangler.preview.jsonc']), { local: false, source: '.private-photos', config: 'wrangler.preview.jsonc' });
    assert.throws(() => parseArgs([]));
    assert.throws(() => parseArgs(['--config']));
    assert.throws(() => parseArgs(['--config', 'x', '--persist-to', 'y']));
    assert.throws(() => parseArgs(['--config', 'x', '--surprise']));
  });

  test('photo preparation names photos by content and reads phone dates', () => {
    assert.match(photoId(Buffer.from('a')), /^[a-f0-9]{16}$/);
    assert.equal(photoId(Buffer.from('a')), photoId(Buffer.from('a')));
    assert.equal(exifDate(Buffer.from('xx2026:07:01 09:00:00xx')), '2026-07-01');
    assert.equal(exifDate(undefined), null);
  });
});

describe('letter upload', () => {
  test('a letter has exactly a salutation, paragraphs and a closing', () => {
    assert.deepEqual(parseLetter({ salutation: 'a', paragraphs: ['b'], closing: 'c' }), { salutation: 'a', paragraphs: ['b'], closing: 'c' });
    assert.throws(() => parseLetter({ salutation: 'a', paragraphs: [], closing: 'c' }));
    assert.throws(() => parseLetter({ salutation: 'a', paragraphs: ['  '], closing: 'c' }));
    assert.throws(() => parseLetter({ salutation: 'a', paragraphs: ['b'], closing: 'c', extra: 1 }));
  });

  test('checking is offline, and uploading prints nothing private and targets the chosen config', t => {
    // Run the real script against a fake Wrangler so no credentials or network are involved.
    const root = mkdtempSync(join(tmpdir(), 'loveuhqq-letter-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const dir of ['scripts', 'worker', '.private-letter', 'node_modules/wrangler/bin']) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    copyFileSync(new URL('../../scripts/upload-letter.mjs', import.meta.url), join(root, 'scripts/upload-letter.mjs'));
    copyFileSync(new URL('../../worker/letter.ts', import.meta.url), join(root, 'worker/letter.ts'));
    const record = join(root, 'called.json');
    writeFileSync(join(root, 'node_modules/wrangler/bin/wrangler.js'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2))); console.log('fake output');`);
    writeFileSync(join(root, 'wrangler.preview.jsonc'), JSON.stringify({ name: 'loveuhqq-site-preview', kv_namespaces: [{ binding: 'PHOTOS', id: 'preview-kv' }] }));
    const secret = 'ONLY_IN_THE_PRIVATE_FILE';
    writeFileSync(join(root, '.private-letter/hundred-day.json'), JSON.stringify({ salutation: 'x', paragraphs: [secret], closing: 'y' }));
    const run = (...args) => spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(root, 'scripts/upload-letter.mjs'), ...args], { encoding: 'utf8', cwd: root });

    const check = run('--config', 'wrangler.preview.jsonc', '--check');
    assert.equal(check.status, 0, check.stderr);
    assert.equal(existsSync(record), false, 'a check never calls Wrangler');
    assert.ok(!`${check.stdout}${check.stderr}`.includes(secret));

    const upload = run('--config', 'wrangler.preview.jsonc');
    assert.equal(upload.status, 0, upload.stderr);
    const args = JSON.parse(readFileSync(record, 'utf8'));
    assert.ok(args.includes('preview-kv') || args.some(arg => arg.includes('wrangler.preview.jsonc')));
    assert.ok(!`${upload.stdout}${upload.stderr}`.includes(secret), 'the letter text is never printed');
  });
});
