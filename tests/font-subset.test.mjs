import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCharset } from '../scripts/subset-font.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontPath = join(root, 'src', 'assets', 'fonts', 'noto-serif-sc-400-subset.woff2');
const charsetPath = join(root, 'src', 'assets', 'fonts', 'subset-chars.txt');

test('the serif subset file exists and is a real woff2', () => {
  assert.equal(existsSync(fontPath), true, 'font subset missing; run `npm run subset:font`');
  const font = readFileSync(fontPath);
  assert.ok(font.length > 10_000, 'font subset looks truncated');
  assert.equal(font.subarray(0, 4).toString('latin1'), 'wOF2', 'font subset is not woff2');
});

test('the committed charset covers every character used in src', () => {
  assert.equal(existsSync(charsetPath), true, 'charset manifest missing; run `npm run subset:font`');
  // Space sorts first in the charset, so strip only the trailing newline.
  const committed = new Set(readFileSync(charsetPath, 'utf8').split('\n')[0].split(''));
  const used = collectCharset();
  const missing = used.filter((char) => !committed.has(char));
  assert.deepEqual(
    missing,
    [],
    `new characters are not in the font subset: ${missing.join(' ')} — run \`npm run subset:font\` and commit the result`,
  );
});
