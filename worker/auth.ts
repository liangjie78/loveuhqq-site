export const sessionCookieName = '__Host-loveuhqq_session';
export const passwordIterations = 100_000;
const encoder = new TextEncoder();

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function unhex(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

export function isPasswordHash(value: unknown): value is string {
  return typeof value === 'string' && /^pbkdf2\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(value);
}

export async function digest(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isPasswordHash(stored)) return false;
  const [, , salt, expected] = stored.split('$');
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const candidate = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: passwordIterations }, key, 256);
  // Native HMAC verification compares fixed-size signatures without a JS secret comparison.
  const comparisonKey = await crypto.subtle.importKey('raw', unhex(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', comparisonKey, unhex(expected));
  return crypto.subtle.verify('HMAC', comparisonKey, signature, candidate);
}

export function randomToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export function readSessionToken(request: Request): string | null {
  const values = (request.headers.get('Cookie') ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${sessionCookieName}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(sessionCookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export function sessionCookie(token: string, maxAge: number): string {
  return `${sessionCookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}
