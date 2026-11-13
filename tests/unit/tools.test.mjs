// The maintenance scripts that move private photos and the letter into storage.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendPhotoSql, parseArgs } from '../../scripts/upload-photos.mjs';
import { exifDate, photoId } from '../../scripts/prepare-photos.mjs';
import { parseLetter } from '../../worker/letter.ts';
import { albumClock, albumInitialization } from '../../worker/album-sql.ts';

describe('photo upload script', () => {
  test('bulk append preserves legacy metadata, existing objects, and recently removed photos', () => {
    const photos = Array.from({ length: 900 }, (_, index) => ({ id: index.toString(16).padStart(16, '0'), title: `它's 第${index}张 🌊`, date: '2026-08-15', width: 800, height: 600 }));
    const manifest = { version: 1, revision: 7, featured: [photos[0].id], photos };
    const db = new DatabaseSync(':memory:');
    const migrations = new URL('../../migrations/', import.meta.url);
    for (const name of readdirSync(migrations).sort()) db.exec(readFileSync(new URL(name, migrations), 'utf8'));
    for (const { sql, args } of albumInitialization(manifest)) {
      assert.ok(Buffer.byteLength(sql) + Buffer.byteLength(String(args[0])) < 100_000);
      db.prepare(sql).run(...args);
    }
    const photo = id => db.prepare('SELECT title, object_id, featured_rank, removed_at FROM album_photos WHERE id = ?').get(id);
    assert.equal(photo(photos.at(-1).id).title, "它's 第899张 🌊");
    assert.equal(photo(photos[0].id).object_id, photos[0].id);
    assert.equal(db.prepare('SELECT revision FROM album_state').get().revision, 7);
    db.prepare('UPDATE album_photos SET removed_at = 123 WHERE id = ?').run(photos[1].id);
    const append = entry => {
      db.prepare(`INSERT INTO album_uploads VALUES (?, ${albumClock} + 50000)`).run(entry.objectId);
      db.exec(appendPhotoSql(entry));
    };
    append({ ...photos[0], objectId: 'duplicate', title: '过时的标题', featured: true });
    append({ ...photos[1], objectId: 'removed', featured: false });
    const entry = { id: 'ffffffffffffffff', objectId: 'new-object', title: "新's 🌊", date: null, width: 800, height: 600, featured: true };
    append(entry);
    assert.equal(photo(photos[0].id).title, photos[0].title);
    assert.equal(photo(photos[1].id).removed_at, 123);
    assert.deepEqual({ ...photo(entry.id) }, { title: entry.title, object_id: entry.objectId, featured_rank: 2, removed_at: null });
    assert.equal(db.prepare('SELECT revision FROM album_state').get().revision, 9);
    db.close();
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
