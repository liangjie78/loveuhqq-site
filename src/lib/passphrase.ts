export const PASSPHRASE_SALT = 'loveuhqq:';
export const PASSPHRASE_STORAGE_KEY = 'loveuhqq_auth';

// SHA-256 hashes of salted allowed passphrases:
// '0701', '20260701', '2026-07-01', '07.01', '2026.07.01'
export const VALID_PASSPHRASE_HASHES = [
  'f149778c85d83f036762e9fb5a143179536cbf940ba1aa62096c70f19ad6f86b', // 0701
  '2221bd2159401354349fa6a805c96dc4c886d8e23ad4baa9b42e61e5f26ab728', // 20260701
  '68c81a8ce56eaab3b8add95aec06633022e837766e5024d4ffba14678f6e980e', // 2026-07-01
  'd3280b78e83a2c235fbbae67c0b4978d8b2b69430a4c9f458b7b9a833ece6201', // 07.01
  '169af23cff7c4856eaa733573aabd63da3b346b64d2eeb90269b42576f81146d', // 2026.07.01
] as const;

export async function hashPassphrase(input: string, salt: string = PASSPHRASE_SALT): Promise<string> {
  const normalized = input.trim().toLowerCase();
  const textBuffer = new TextEncoder().encode(salt + normalized);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', textBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyPassphrase(input: string): Promise<boolean> {
  if (!input || !input.trim()) return false;
  const hash = await hashPassphrase(input);
  return (VALID_PASSPHRASE_HASHES as readonly string[]).includes(hash);
}

export function isPassphraseUnlocked(storage?: { getItem: (key: string) => string | null }): boolean {
  try {
    if (storage) {
      return storage.getItem(PASSPHRASE_STORAGE_KEY) === 'unlocked';
    }
    if (typeof window === 'undefined') return false;
    return (
      window.localStorage.getItem(PASSPHRASE_STORAGE_KEY) === 'unlocked' ||
      window.sessionStorage.getItem(PASSPHRASE_STORAGE_KEY) === 'unlocked'
    );
  } catch {
    return false;
  }
}

export function savePassphraseUnlock(rememberDevice: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    if (rememberDevice) {
      window.localStorage.setItem(PASSPHRASE_STORAGE_KEY, 'unlocked');
    } else {
      window.sessionStorage.setItem(PASSPHRASE_STORAGE_KEY, 'unlocked');
    }
  } catch {
    // Ignore storage quota or access exceptions in restricted iframes/browsers
  }
}

export function clearPassphraseUnlock(): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(PASSPHRASE_STORAGE_KEY);
    window.sessionStorage.removeItem(PASSPHRASE_STORAGE_KEY);
  } catch {
    // Ignore storage exceptions
  }
}
