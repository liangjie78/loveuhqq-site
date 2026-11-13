/*
 * Appends prepared photos to the album in bounded batches.
 * Published and recently removed photos keep their existing metadata and objects.
 * Usage: npm run photos:upload:preview | photos:upload:production | photos:upload:local
 * Options: --config <file> --source <dir> --local [--persist-to <dir>]
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emptyPhotoManifest, featuredPhotoCount, maxPhotos, parsePhotoManifest, photoManifestKey, photoObjectKey, photoSizes } from '../src/lib/photos.ts';
import { albumClock, albumInitialization, albumRevisionSql, legacyAlbumSql, uploadGraceMs } from '../worker/album-sql.ts';

const literal = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${value.replaceAll("'", "''")}'`;
const maxObjectBytes = 25 * 1024 * 1024;
const maxBatchBytes = 64 * 1024 * 1024; // Base64 and JSON stay below the KV bulk API's 100 MB limit.

export function appendPhotoSql({ id, objectId, title, date, width, height, featured }) {
  const [photo, object, ...fields] = [id, objectId, title, date, width, height].map(literal);
  // A fresh object ID means losing a race can never overwrite another upload's bytes.
  const rank = featured ? `(SELECT CASE WHEN COUNT(*) < ${featuredPhotoCount}
    THEN COALESCE(MAX(featured_rank), 0) + 1 END FROM album_photos WHERE featured_rank IS NOT NULL)` : 'NULL';
  return `INSERT INTO album_photos (id, object_id, title, date, width, height, featured_rank)
SELECT ${photo}, ${object}, ${fields.join(', ')}, ${rank}
WHERE EXISTS (SELECT 1 FROM album_uploads WHERE object_id = ${object} AND expires_at > ${albumClock})
  AND (SELECT COUNT(*) FROM album_photos WHERE removed_at IS NULL) < ${maxPhotos}
ON CONFLICT(id) DO NOTHING;
DELETE FROM album_uploads WHERE object_id = ${object}
  AND EXISTS (SELECT 1 FROM album_photos WHERE object_id = ${object});`;
}

export function parseArgs(args) {
  const options = { local: false, source: '.private-photos' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--local') options.local = true;
    else if (['--config', '--source', '--persist-to'].includes(flag)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      options[flag.slice(2)] = value;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (!options.config) throw new Error('Usage: node scripts/upload-photos.mjs --config <wrangler config>');
  if (options['persist-to'] && !options.local) throw new Error('--persist-to requires --local');
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = resolve(root, options.source);
  const configPath = resolve(root, options.config);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const namespace = config.kv_namespaces?.find(binding => binding.binding === 'PHOTOS')?.id;
  const database = config.d1_databases?.find(binding => binding.binding === 'DB')?.database_name;
  if (!namespace || !database) throw new Error(`${options.config} requires PHOTOS KV and DB D1 bindings.`);
  const manifestPath = join(source, photoManifestKey);
  if (!existsSync(manifestPath)) throw new Error('Run `npm run photos:prepare -- <folder>` first.');
  const manifest = parsePhotoManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const scratch = mkdtempSync(join(tmpdir(), 'loveuhqq-photos-'));
  const flags = [options.local ? '--local' : '--remote', '--config', configPath];
  if (options['persist-to']) flags.push('--persist-to', resolve(root, options['persist-to']));
  function run(args, capture = false) {
    const result = spawnSync(process.execPath, [wrangler, ...args, ...flags], {
      cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...(options.local ? { CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false' } : {}) },
    });
    if (result.error) throw result.error;
    // Wrangler output can include album contents or request details.
    if (result.status !== 0) throw new Error(`Photo upload failed at ${args[0]} ${args[1]}`);
    return result.stdout?.trim();
  }
  const query = command => JSON.parse(run(['d1', 'execute', database, '--command', command, '--json'], true))[0].results;
  const sql = join(scratch, 'album.sql');
  const execute = statements => {
    writeFileSync(sql, statements.join('\n'), { mode: 0o600 });
    run(['d1', 'execute', database, '--file', sql]);
  };
  const kv = ['--namespace-id', namespace];
  const listKeys = prefix => JSON.parse(run(['kv', 'key', 'list', '--prefix', prefix, ...kv], true)).map(({ name }) => name);
  try {
    if (options.local) {
      const envFile = join(scratch, 'local.env');
      writeFileSync(envFile, '');
      flags.push('--env-file', envFile);
    }
    if (!query(albumRevisionSql).length) {
      const [row] = query(legacyAlbumSql);
      const legacy = row ? { ...JSON.parse(row.manifest), revision: row.revision }
        : listKeys(photoManifestKey).includes(photoManifestKey)
          ? JSON.parse(run(['kv', 'key', 'get', photoManifestKey, '--text', ...kv], true)) : null;
      execute(albumInitialization(legacy == null ? emptyPhotoManifest() : parsePhotoManifest(legacy))
        .map(({ sql, args }) => `${sql.replace('?', literal(args[0]))};`));
    }
    const known = query('SELECT id, removed_at FROM album_photos');
    const existing = new Set(known.map(photo => photo.id));
    const pending = manifest.photos.filter(photo => !existing.has(photo.id));
    if (pending.length + known.filter(photo => photo.removed_at === null).length > maxPhotos) throw new Error('The album does not have enough room for these photos.');
    // Honor the supplied featured order for new entries, filling only unused slots.
    const order = new Map(manifest.featured.map((id, index) => [id, index]));
    pending.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
    const batches = [];
    let batch = [];
    let batchBytes = 0;
    for (const photo of pending) {
      const bytes = photoSizes.reduce((total, size) => {
        const file = statSync(join(source, photoObjectKey(photo.id, size)), { throwIfNoEntry: false });
        if (!file?.isFile() || file.size < 12 || file.size > maxObjectBytes) throw new Error('A prepared rendition is missing or exceeds the KV object limit.');
        return total + file.size;
      }, 0);
      if (batch.length === 4 || batchBytes + bytes > maxBatchBytes) {
        batches.push(batch);
        batch = [];
        batchBytes = 0;
      }
      batch.push(photo);
      batchBytes += bytes;
    }
    if (batch.length) batches.push(batch);
    const bulk = join(scratch, 'bulk.json');
    let processed = 0;
    let appended = 0;
    let missing = 0;
    for (const photos of batches) {
      const batchId = randomUUID();
      const group = photos.map((photo, index) => ({ ...photo, objectId: `${batchId}-${index}`, featured: order.has(photo.id) }));
      execute(group.map(({ objectId }) => `INSERT INTO album_uploads VALUES (${literal(objectId)}, ${albumClock} + ${uploadGraceMs});`));
      const objects = group.flatMap(photo => photoSizes.map(size => ({
        key: photoObjectKey(photo.objectId, size), value: readFileSync(join(source, photoObjectKey(photo.id, size))).toString('base64'), base64: true,
      })));
      writeFileSync(bulk, JSON.stringify(objects), { mode: 0o600 });
      run(['kv', 'bulk', 'put', bulk, ...kv]);
      // Wrangler can exit successfully even when the bulk API reports individual failed keys.
      if (!options.local) {
        const uploaded = new Set(listKeys(`photos/${batchId}-`));
        if (objects.some(({ key }) => !uploaded.has(key))) throw new Error('One or more KV renditions are missing. Retry this batch before publishing.');
      }
      execute(group.map(appendPhotoSql));
      const saved = query(`SELECT object_id FROM album_photos WHERE id IN (${group.map(({ id }) => literal(id)).join(', ')})`);
      const objectsWritten = new Set(group.map(photo => photo.objectId));
      appended += saved.filter(({ object_id }) => objectsWritten.has(object_id)).length;
      missing += group.length - saved.length;
      processed += group.length;
      console.log(`Processed ${processed}/${pending.length} new photos`);
    }
    console.log(`${appended} appended, ${manifest.photos.length - appended - missing} already present or removed, ${missing} could not be appended`);
    if (missing) throw new Error('The album changed during the upload. Check its remaining capacity before retrying.');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
