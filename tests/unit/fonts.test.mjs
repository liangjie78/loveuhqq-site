// Self-hosted fonts: present, covering every character on the pages, and never leaking private words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { asciiCharset, charsetOutPath, collectCharset, collectWorkerOnlyCharset, fontOutputs } from '../../scripts/subset-font.mjs';

test('every shipped font is a woff2 file', () => {
  for (const path of Object.values(fontOutputs)) assert.equal(readFileSync(path).subarray(0, 4).toString('latin1'), 'wOF2', path);
});

test('the serif subset covers every character in src/', () => {
  const committed = new Set(readFileSync(charsetOutPath, 'utf8').split('\n')[0]);
  const missing = collectCharset().filter(char => !committed.has(char));
  assert.deepEqual(missing, [], `run \`npm run subset:font\` — missing: ${missing.join(' ')}`);
});

test('characters that only the Worker uses (the private letter) never reach the public font', () => {
  const committed = readFileSync(charsetOutPath, 'utf8').split('\n')[0];
  assert.deepEqual(collectWorkerOnlyCharset().filter(char => committed.includes(char)), []);
});

test('the Latin face is cut to printable ASCII', () => {
  assert.equal(asciiCharset().length, 95);
});
