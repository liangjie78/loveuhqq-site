/*
 * Builds the single woff2 subset that ships with the site.
 *
 * The journal renders a fixed, small set of Song-style glyphs (roughly 200
 * hanzi plus punctuation), so the whole fontsource family is dead weight:
 * 101 @font-face rules in the render-blocking CSS and 3.5MB of slices.
 * This script scans every character in src/ (comments included — better a
 * few spare glyphs than a silent fallback) and cuts one 400-weight woff2.
 *
 * Usage: npm run subset:font
 * Run it again after adding new visible copy; tests/font-subset.test.mjs
 * fails the build when the charset file no longer matches src/.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// google/fonts NotoSerifSC[wght].ttf, pinned by hash. Cached locally only;
// the generated woff2 and charset list are committed so CI never downloads.
const FONT_URL = 'https://github.com/google/fonts/raw/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf';
const FONT_SHA256 = '050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9';
const cachePath = join(root, '.fontcache', 'NotoSerifSC-wght.ttf');

const fontOutPath = join(root, 'src', 'assets', 'fonts', 'noto-serif-sc-400-subset.woff2');
const charsetOutPath = join(root, 'src', 'assets', 'fonts', 'subset-chars.txt');

/** Every character that appears anywhere in src/, plus a printable-ASCII base. */
export function collectCharset() {
  const chars = new Set();
  for (let code = 0x20; code <= 0x7e; code += 1) chars.add(String.fromCodePoint(code));

  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(astro|ts|css)$/.test(entry)) {
        for (const char of readFileSync(path, 'utf8')) {
          if (char >= ' ') chars.add(char);
        }
      }
    }
  };
  walk(join(root, 'src'));

  return [...chars].sort();
}

async function getSourceFont() {
  mkdirSync(dirname(cachePath), { recursive: true });
  const cached = existsSync(cachePath) ? readFileSync(cachePath) : null;
  if (cached && createHash('sha256').update(cached).digest('hex') === FONT_SHA256) return cached;

  console.log(`Downloading ${FONT_URL}`);
  const response = await fetch(FONT_URL);
  if (!response.ok) throw new Error(`Font download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(buffer).digest('hex');
  if (digest !== FONT_SHA256) throw new Error(`Font hash mismatch: ${digest}`);
  writeFileSync(cachePath, buffer);
  return buffer;
}

async function main() {
  const chars = collectCharset();
  const { default: subsetFont } = await import('subset-font');
  const source = await getSourceFont();

  // Pinning the wght axis instances the variable font at regular weight.
  const subset = await subsetFont(source, chars.join(''), {
    targetFormat: 'woff2',
    variationAxes: { wght: { min: 400, max: 400 } },
  });

  mkdirSync(dirname(fontOutPath), { recursive: true });
  writeFileSync(fontOutPath, subset);
  writeFileSync(charsetOutPath, `${chars.join('')}\n`);

  console.log(`${chars.length} chars -> ${fontOutPath} (${(subset.length / 1024).toFixed(1)} KB)`);
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invoked) await main();
