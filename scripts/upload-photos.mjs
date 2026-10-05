/*
 * Uploads .private-photos/ (from `npm run photos:prepare`) to the PHOTOS KV namespace
 * named in the given Wrangler config. Images go in one bulk write and manifest.json in
 * a second, so the album never lists a photo that is not there yet. Keys are only ever
 * added or overwritten; nothing in the namespace is deleted.
 *
 * Usage: npm run photos:upload:preview   (wrangler.preview.jsonc)
 *        npm run photos:upload:production (wrangler.jsonc)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePhotoManifest, photoManifestKey, photoObjectKey, photoSizes } from '../src/lib/photos.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '.private-photos');
const configArg = process.argv.indexOf('--config');
const configPath = configArg > -1 ? process.argv[configArg + 1] : '';
if (!configPath) throw new Error('Usage: node scripts/upload-photos.mjs --config <wrangler config>');

const config = JSON.parse(readFileSync(join(root, configPath), 'utf8'));
const namespace = config.kv_namespaces?.find(binding => binding.binding === 'PHOTOS')?.id;
if (!namespace) throw new Error(`${configPath} has no PHOTOS KV binding.`);

const manifestPath = join(source, photoManifestKey);
if (!existsSync(manifestPath)) throw new Error('Run `npm run photos:prepare -- <folder>` first.');
const manifest = parsePhotoManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));

const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
// The bulk file holds private photos, so it lives in a private temp folder and is always removed.
const scratch = mkdtempSync(join(tmpdir(), 'loveuhqq-photos-'));
function bulkPut(keys) {
  const file = join(scratch, 'bulk.json');
  writeFileSync(file, JSON.stringify(keys.map(key => ({ key, value: readFileSync(join(source, key)).toString('base64'), base64: true }))));
  const result = spawnSync(process.execPath, [wrangler, 'kv', 'bulk', 'put', file, '--namespace-id', namespace, '--remote',
    '--config', configPath], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  rmSync(file, { force: true });
  if (result.status !== 0) throw new Error(`Upload failed: ${keys.length} keys`);
}

try {
  bulkPut(manifest.photos.flatMap(photo => photoSizes.map(size => photoObjectKey(photo.id, size))));
  bulkPut([photoManifestKey]);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`${manifest.photos.length} photos and ${photoManifestKey} -> KV ${namespace}`);
