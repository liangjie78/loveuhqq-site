import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PASSPHRASE_SALT,
  PASSPHRASE_STORAGE_KEY,
  VALID_PASSPHRASE_HASHES,
  clearPassphraseUnlock,
  hashPassphrase,
  isPassphraseUnlocked,
  savePassphraseUnlock,
  verifyPassphrase,
} from '../src/lib/passphrase.ts';

test('exports configuration constants', () => {
  assert.equal(PASSPHRASE_SALT, 'loveuhqq:');
  assert.equal(PASSPHRASE_STORAGE_KEY, 'loveuhqq_auth');
  assert.ok(VALID_PASSPHRASE_HASHES.length >= 4);
});

test('hashes passphrase with salt deterministically', async () => {
  const hash1 = await hashPassphrase('0701');
  const hash2 = await hashPassphrase('0701');
  assert.equal(hash1, hash2);
  assert.equal(typeof hash1, 'string');
  assert.equal(hash1.length, 64);
});

test('verifies standard relationship date formats successfully', async () => {
  assert.equal(await verifyPassphrase('0701'), true);
  assert.equal(await verifyPassphrase('20260701'), true);
  assert.equal(await verifyPassphrase('2026-07-01'), true);
  assert.equal(await verifyPassphrase('07.01'), true);
  assert.equal(await verifyPassphrase('2026.07.01'), true);
});

test('normalizes input by trimming whitespace and casing', async () => {
  assert.equal(await verifyPassphrase('  0701  '), true);
  assert.equal(await verifyPassphrase(' 2026-07-01 \n'), true);
});

test('rejects incorrect passphrases and empty inputs', async () => {
  assert.equal(await verifyPassphrase(''), false);
  assert.equal(await verifyPassphrase('   '), false);
  assert.equal(await verifyPassphrase('0702'), false);
  assert.equal(await verifyPassphrase('123456'), false);
  assert.equal(await verifyPassphrase('password'), false);
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
