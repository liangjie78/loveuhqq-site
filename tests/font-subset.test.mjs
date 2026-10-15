import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCharset, collectWorkerOnlyCharset } from '../scripts/subset-font.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontPath = join(root, 'src', 'assets', 'fonts', 'noto-serif-sc-400-subset.woff2');
const charsetPath = join(root, 'src', 'assets', 'fonts', 'subset-chars.txt');
test('the public serif font is woff2 and covers the source characters', () => {
  const font = readFileSync(fontPath);
  assert.equal(font.subarray(0, 4).toString('latin1'), 'wOF2', 'font subset is not woff2');
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

test('the public subset never discloses Worker-only characters', () => {
  // A shipped font is a character-set oracle: these must never reach it.
  const committed = readFileSync(charsetPath, 'utf8').split('\n')[0];
  const published = collectWorkerOnlyCharset().filter((char) => committed.includes(char));
  assert.deepEqual(
    published,
    [],
    `the shipped font subset carries private Worker characters: ${published.join(' ')}`,
  );
});
