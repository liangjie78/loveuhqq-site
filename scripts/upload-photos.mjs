/*
 * Uploads prepared photos to PHOTOS KV, then commits the album manifest to D1 DB.
 * KV manifest.json is only a legacy source for the Worker's one-time D1 initialization.
 * Images are added or overwritten; no keys are deleted. D1 overwrites bump revision.
 * Usage: npm run photos:upload:preview | photos:upload:production | photos:upload:local
 * Options: --config <file> --source <dir> --local [--persist-to <dir>]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parsePhotoManifest, photoManifestKey, photoObjectKey, photoSizes } from '../src/lib/photos.ts';

export function manifestUpsertSql(manifest) {
  const parsed = parsePhotoManifest(manifest);
  const statements = [
    'CREATE TABLE IF NOT EXISTS photo_manifest_upload (seq INTEGER PRIMARY KEY, part TEXT NOT NULL);',
    'DELETE FROM photo_manifest_upload;',
  ];
  let part = '';
  let bytes = 0;
  let seq = 0;
  const flush = () => {
    statements.push(`INSERT INTO photo_manifest_upload (seq, part) VALUES (${seq++}, '${part}');`);
    part = '';
    bytes = 0;
  };
  // Budget the escaped literal in UTF-8, leaving ample room below D1's 100 KB
  // statement limit. Iterating code points also preserves surrogate pairs.
  for (const character of JSON.stringify(parsed)) {
    const escaped = character === "'" ? "''" : character;
    const size = Buffer.byteLength(escaped, 'utf8');
    if (bytes + size > 50_000) flush();
    part += escaped;
    bytes += size;
  }
  if (part) flush();
  // Only this statement touches the live row; the ordered subquery preserves
  // chunk order. WHERE true disambiguates SQLite's INSERT SELECT UPSERT syntax.
  statements.push(`INSERT INTO photo_manifest (id, manifest, revision) SELECT 1, (SELECT group_concat(part, '') FROM (SELECT part FROM photo_manifest_upload ORDER BY seq)), ${parsed.revision} WHERE true ON CONFLICT(id) DO UPDATE SET manifest = excluded.manifest, revision = photo_manifest.revision + 1;`);
  statements.push('DROP TABLE photo_manifest_upload;');
  return `${statements.join('\n')}\n`;
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
  function run(args) {
    const result = spawnSync(process.execPath, [wrangler, ...args, ...flags], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Photo upload failed');
  }
  try {
    const bulk = join(scratch, 'bulk.json');
    const keys = manifest.photos.flatMap(photo => photoSizes.map(size => photoObjectKey(photo.id, size)));
    writeFileSync(bulk, JSON.stringify(keys.map(key => ({ key, value: readFileSync(join(source, key)).toString('base64'), base64: true }))), { mode: 0o600 });
    run(['kv', 'bulk', 'put', bulk, '--namespace-id', namespace]);
    const sql = join(scratch, 'manifest.sql');
    writeFileSync(sql, manifestUpsertSql(manifest), { mode: 0o600 });
    run(['d1', 'execute', database, '--file', sql]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`${manifest.photos.length} photos -> KV; manifest -> D1 ${database}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
