/** Client-side preparation for "贴一张": everything is re-encoded, so EXIF never leaves the device. */

export function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '').normalize('NFC').trim().slice(0, 80);
}

/** Best-effort EXIF DateTimeOriginal / DateTime from the first 128 KiB. */
export function exifDateFromBytes(buffer: ArrayBuffer): string | null {
  const sample = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 128 * 1024));
  const text = new TextDecoder('latin1').decode(sample);
  const match = text.match(/(\d{4}):(\d{2}):(\d{2}) \d{2}:\d{2}:\d{2}/);
  if (!match || match[1] === '0000') return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? null : date;
}

export async function sha16(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function encodeWebp(source: ImageBitmap, maxWidth: number, maxHeight: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = fitWithin(source.width, source.height, maxWidth, maxHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  context.drawImage(source, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => (value ? resolve(value) : reject(new Error('webp'))), 'image/webp', quality);
  });
  return { blob, width, height };
}

export const looksLikeImage = (file: File) => file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name);

/** Spreads items into columns, always topping up the shortest one. Order is kept within columns. */
export function balanceColumns<T>(items: T[], ratios: number[], columns: number): T[][] {
  const out: T[][] = Array.from({ length: columns }, () => []);
  const heights = new Array(columns).fill(0);
  items.forEach((item, index) => {
    const target = heights.indexOf(Math.min(...heights));
    out[target].push(item);
    heights[target] += Math.min(1.5, 1 / (ratios[index] || 1));
  });
  return out;
}
