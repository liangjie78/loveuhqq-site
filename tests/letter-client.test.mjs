import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

/*
 * src/scripts/letter.ts is a browser module, so this exercises it by bundling
 * rather than by faking a DOM. The bundle also proves the script still compiles
 * and resolves its imports, which no other test covers.
 */
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/scripts/letter.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  logLevel: 'silent',
});

const client = bundled.outputFiles[0].text;
// esbuild inlines src/lib/anniversary.ts, so only letter.ts's own lines are read.
const letterSource = client.slice(client.indexOf('// src/scripts/letter.ts'));
assert.ok(letterSource.length > 0, 'the bundle did not expose src/scripts/letter.ts');

test('the letter client clears private text and aborts late responses', () => {
  // Guards the DESIGN.md promise that closing, logout and bfcache restore wipe
  // the letter instead of leaving it in the DOM.
  assert.ok(letterSource.includes('replaceChildren'), 'letter.ts no longer clears rendered text');
  assert.ok(letterSource.includes('abort'), 'letter.ts no longer aborts an in-flight request');
  assert.ok(letterSource.includes('pagehide'), 'letter.ts no longer clears on pagehide');
});

test('the midnight rollover cannot re-enter immediately', () => {
  assert.ok(
    // esbuild reprints 1000 as 1e3.
    letterSource.includes('Math.max(1e3') || letterSource.includes('Math.max(1000'),
    'letter.ts schedules the midnight rollover without a minimum delay',
  );
});

test('the letter gate uses the shared day calculation', () => {
  // The gate must not grow its own local-date arithmetic: the day count has to
  // stay identical to the Worker's, which imports the same helper.
  assert.ok(
    letterSource.includes('getAnniversaryDay('),
    'letter.ts no longer calls the shared day calculation',
  );
  assert.ok(
    !/getMonth\(\)|getDate\(\)|getFullYear\(\)/.test(letterSource),
    'letter.ts hand-rolls a local calendar date instead of using the shared helper',
  );
});
