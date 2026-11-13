/*
 * Turns a folder of original photos into the private album that goes to Workers KV.
 *
 * Usage: npm run photos:prepare -- <source-folder> [--featured "标题,标题,标题"]
 *
 * Each file name (without extension) becomes the photo's title. Output goes to
 * .private-photos/ (git-ignored): a 800×1000-bounded thumbnail and a 1800px-bounded
 * large rendition per photo, both WebP with every bit of EXIF/GPS metadata dropped,
 * plus manifest.json. Photos are ordered by the date in their EXIF (undated last).
 * Originals never enter the repository; upload with `npm run photos:upload:*`.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { isCalendarDate } from '../src/lib/notebook.ts';
import { parsePhotoManifest, photoManifestKey, photoObjectKey, sortPhotos } from '../src/lib/photos.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const outDir = join(root, '.private-photos');

/** EXIF DateTimeOriginal/DateTime is plain ASCII "YYYY:MM:DD HH:MM:SS" in phone local time. */
export function exifDate(exif) {
  const match = exif?.toString('latin1').match(/(\d{4}):(\d{2}):(\d{2}) \d{2}:\d{2}:\d{2}/);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return isCalendarDate(date) ? date : null;
}

export const photoId = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

async function main() {
  const args = process.argv.slice(2);
  const source = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--featured');
  if (!source) throw new Error('Usage: npm run photos:prepare -- <source-folder> [--featured "标题,标题,标题"]');
  const featuredArg = args.includes('--featured') ? args[args.indexOf('--featured') + 1] : '';
  const featuredTitles = featuredArg ? featuredArg.split(/[,，]/).map(title => title.trim()).filter(Boolean) : [];

  const files = readdirSync(source, { withFileTypes: true })
    .filter(file => file.isFile() && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name))
    .map(file => file.name).sort();
  if (!files.length) throw new Error('No photos found in the source folder.');
  const photos = [];
  for (const name of files) {
    const bytes = readFileSync(join(source, name));
    const id = photoId(bytes);
    const title = basename(name, extname(name)).normalize('NFC').trim();
    const { exif } = await sharp(bytes).metadata();
    // rotate() applies the EXIF orientation; sharp drops all metadata unless asked to keep it.
    const image = () => sharp(bytes).rotate();
    mkdirSync(join(outDir, dirname(photoObjectKey(id, 'thumb'))), { recursive: true });
    await image().resize({ width: 800, height: 1000, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 }).toFile(join(outDir, photoObjectKey(id, 'thumb')));
    const large = await image().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toFile(join(outDir, photoObjectKey(id, 'large')));
    const date = exifDate(exif);
    photos.push({ id, title, date, width: large.width, height: large.height });
    console.log(`${id}  ${date ?? '----------'}  ${large.width}×${large.height}  ${title}`);
  }

  const featured = featuredTitles.map(title => {
    const match = photos.find(photo => photo.title === title);
    if (!match) throw new Error(`No photo titled "${title}"`);
    return match.id;
  });
  const manifest = parsePhotoManifest({ version: 1, featured, photos: sortPhotos(photos) });
  writeFileSync(join(outDir, photoManifestKey), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${photos.length} photos -> ${outDir}`);
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invoked) await main();
