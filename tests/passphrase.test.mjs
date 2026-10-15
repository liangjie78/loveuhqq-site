import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PASSPHRASE_STORAGE_KEY,
  isPassphraseUnlocked,
  verifyPassphrase,
} from '../src/lib/passphrase.ts';

test('accepts the supported date formats after trimming whitespace', async () => {
  assert.equal(await verifyPassphrase('  0701 \n'), true);
  assert.equal(await verifyPassphrase('20260701'), true);
  assert.equal(await verifyPassphrase('2026-07-01'), true);
  assert.equal(await verifyPassphrase('07.01'), true);
  assert.equal(await verifyPassphrase('2026.07.01'), true);
});

test('rejects incorrect passphrases and empty inputs', async () => {
  assert.equal(await verifyPassphrase('   '), false);
  assert.equal(await verifyPassphrase('0702'), false);
});

test('checks unlocked state from storage', () => {
  const mockStorage = {
    data: {},
    getItem(key) {
      return this.data[key] || null;
    },
    setItem(key, value) {
      this.data[key] = value;
    },
  };

  assert.equal(isPassphraseUnlocked(mockStorage), false);
  mockStorage.setItem(PASSPHRASE_STORAGE_KEY, 'unlocked');
  assert.equal(isPassphraseUnlocked(mockStorage), true);
});
