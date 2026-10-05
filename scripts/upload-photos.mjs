/*
 * Uploads .private-photos/ (from `npm run photos:prepare`) to the PHOTOS R2 bucket
 * named in the given Wrangler config. Images go first and manifest.json last, so the
 * album never lists a photo that is not there yet. Objects are only ever added or
 * overwritten; nothing in the bucket is deleted.
 *
 * Usage: npm run photos:upload:preview   (wrangler.preview.jsonc)
 *        npm run photos:upload:production (wrangler.jsonc)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePhotoManifest, photoManifestKey, photoObjectKey, photoSizes } from '../src/lib/photos.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '.private-photos');
const configArg = process.argv.indexOf('--config');
const configPath = configArg > -1 ? process.argv[configArg + 1] : '';
if (!configPath) throw new Error('Usage: node scripts/upload-photos.mjs --config <wrangler config>');

const config = JSON.parse(readFileSync(join(root, configPath), 'utf8'));
const bucket = config.r2_buckets?.find(binding => binding.binding === 'PHOTOS')?.bucket_name;
if (!bucket) throw new Error(`${configPath} has no PHOTOS R2 binding.`);

const manifestPath = join(source, photoManifestKey);
if (!existsSync(manifestPath)) throw new Error('Run `npm run photos:prepare -- <folder>` first.');
const manifest = parsePhotoManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));

const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
function put(key, contentType) {
  const result = spawnSync(process.execPath, [wrangler, 'r2', 'object', 'put', `${bucket}/${key}`, '--remote',
    '--config', configPath, '--file', join(source, key), '--content-type', contentType], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  if (result.status !== 0) throw new Error(`Upload failed: ${key}`);
}

for (const photo of manifest.photos) {
  for (const size of photoSizes) put(photoObjectKey(photo.id, size), 'image/webp');
  console.log(`${bucket}: ${photo.title}`);
}
put(photoManifestKey, 'application/json');
console.log(`${manifest.photos.length} photos and ${photoManifestKey} -> ${bucket}`);
