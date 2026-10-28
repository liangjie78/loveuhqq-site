/*
 * Builds the self-hosted font subsets that ship with the site.
 *
 * - Noto Serif SC, cut to the characters that appear in src/ and kept variable
 *   on the weight axis (300–500) so display type can breathe between weights.
 * - Instrument Serif (regular + italic), cut to printable ASCII, for numerals,
 *   dates and the wordmark.
 *
 * The CJK subset only ever contains characters from src/. Characters that appear
 * nowhere but the Worker (the private hundred-day letter lives there) are held
 * out and recorded in worker-only-chars.txt — a shipped font is a character-set
 * oracle, so including them would let a visitor recover private wording.
 *
 * Usage: npm run subset:font — run it again after adding new visible copy; the
 * font test fails when the committed charset no longer covers src/.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fontsDir = join(root, 'src', 'assets', 'fonts');

// google/fonts sources, pinned by hash. Cached locally only; the generated woff2
// files and charset lists are committed so CI never downloads.
const SOURCES = {
  serif: {
    url: 'https://github.com/google/fonts/raw/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf',
    sha256: '050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9',
    cache: 'NotoSerifSC-wght.ttf',
  },
  latin: {
    url: 'https://github.com/google/fonts/raw/main/ofl/instrumentserif/InstrumentSerif-Regular.ttf',
    sha256: '498efd461f6ddfcb7a111bf9a565709d2085d48201d501ead960d93e84ffbb88',
    cache: 'InstrumentSerif-Regular.ttf',
  },
  latinItalic: {
    url: 'https://github.com/google/fonts/raw/main/ofl/instrumentserif/InstrumentSerif-Italic.ttf',
    sha256: '08939b8bdf534afec24ae0ef5e03f948940cd9a8fe08e7fecbad040e62327385',
    cache: 'InstrumentSerif-Italic.ttf',
  },
};

export const SERIF_WEIGHT = { min: 300, max: 500 };
export const fontOutputs = {
  serif: join(fontsDir, 'noto-serif-sc-subset.woff2'),
  latin: join(fontsDir, 'instrument-serif-regular.woff2'),
  latinItalic: join(fontsDir, 'instrument-serif-italic.woff2'),
};
export const charsetOutPath = join(fontsDir, 'subset-chars.txt');
/** Private Worker characters the public subset must never gain. */
export const privateCharsetOutPath = join(fontsDir, 'worker-only-chars.txt');

function collectChars(dir) {
  const chars = new Set();
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(astro|ts|tsx|css)$/.test(entry)) {
        for (const char of readFileSync(path, 'utf8')) if (char >= ' ') chars.add(char);
      }
    }
  };
  walk(dir);
  return chars;
}

export const asciiCharset = () => Array.from({ length: 0x7f - 0x20 }, (_, index) => String.fromCodePoint(0x20 + index));

/** Every character that appears anywhere in src/, plus a printable-ASCII base. */
export function collectCharset() {
  const chars = new Set(asciiCharset());
  for (const char of collectChars(join(root, 'src'))) chars.add(char);
  return [...chars].sort();
}

/** Characters used only by the Worker, which holds the private letter. */
export function collectWorkerOnlyCharset() {
  const publicChars = collectChars(join(root, 'src'));
  return [...collectChars(join(root, 'worker'))].filter((char) => !publicChars.has(char)).sort();
}

async function getSource({ url, sha256, cache }) {
  const cachePath = join(root, '.fontcache', cache);
  mkdirSync(dirname(cachePath), { recursive: true });
  const cached = existsSync(cachePath) ? readFileSync(cachePath) : null;
  if (cached && createHash('sha256').update(cached).digest('hex') === sha256) return cached;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Font download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(buffer).digest('hex');
  if (digest !== sha256) throw new Error(`Font hash mismatch for ${cache}: ${digest}`);
  writeFileSync(cachePath, buffer);
  return buffer;
}

async function main() {
  const chars = collectCharset();
  const workerOnly = collectWorkerOnlyCharset();
  const { default: subsetFont } = await import('subset-font');
  mkdirSync(fontsDir, { recursive: true });

  const serif = await subsetFont(await getSource(SOURCES.serif), chars.join(''), {
    targetFormat: 'woff2',
    variationAxes: { wght: SERIF_WEIGHT },
  });
  writeFileSync(fontOutputs.serif, serif);

  const ascii = asciiCharset().join('');
  for (const key of ['latin', 'latinItalic']) {
    const subset = await subsetFont(await getSource(SOURCES[key]), ascii, { targetFormat: 'woff2' });
    writeFileSync(fontOutputs[key], subset);
    console.log(`${key} -> ${fontOutputs[key]} (${(subset.length / 1024).toFixed(1)} KB)`);
  }

  writeFileSync(charsetOutPath, `${chars.join('')}\n`);
  writeFileSync(privateCharsetOutPath, `${workerOnly.join('')}\n`);
  console.log(`${chars.length} chars -> ${fontOutputs.serif} (${(serif.length / 1024).toFixed(1)} KB, wght ${SERIF_WEIGHT.min}–${SERIF_WEIGHT.max})`);
  console.log(`${workerOnly.length} worker-only chars held out of the subset`);
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invoked) await main();
