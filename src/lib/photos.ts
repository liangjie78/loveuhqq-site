/**
 * The private album. Photos, titles and dates live in Workers KV behind the Worker's session
 * check; nothing here is private, only the shape both sides agree on.
 */
export interface PrivatePhoto {
  /** First 16 hex chars of the source file's SHA-256, so a changed photo gets a new URL. */
  id: string;
  title: string;
  /** Shanghai calendar date the photo or screenshot was taken, when known. */
  date: string | null;
  /** Pixel size of the large rendition; the thumbnail keeps the same ratio. */
  width: number;
  height: number;
}

export interface PhotoManifest {
  version: 1;
  /** Ids shown on the homepage, in order. */
  featured: string[];
  photos: PrivatePhoto[];
}

export const photoSizes = ['thumb', 'large'] as const;
export type PhotoSize = (typeof photoSizes)[number];
export const photoIdPattern = /^[a-f0-9]{16}$/;
export const photoManifestKey = 'manifest.json';
export const featuredPhotoCount = 3;
const maxPhotos = 2000;

export const photoObjectKey = (id: string, size: PhotoSize) => `photos/${id}/${size}.webp`;
export const photoUrl = (id: string, size: PhotoSize) => `/api/photos/${id}/${size}`;
export const emptyPhotoManifest = (): PhotoManifest => ({ version: 1, featured: [], photos: [] });

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const isSize = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 10_000;

/** Validates a manifest from storage or the API; throws on anything unexpected. */
export function parsePhotoManifest(value: unknown): PhotoManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid photo manifest');
  const { version, featured, photos } = value as Record<string, unknown>;
  if (version !== 1 || !Array.isArray(featured) || !Array.isArray(photos) || photos.length > maxPhotos) {
    throw new Error('Invalid photo manifest');
  }
  const ids = new Set<string>();
  const parsed = photos.map((photo): PrivatePhoto => {
    const { id, title, date, width, height } = (photo ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || !photoIdPattern.test(id) || ids.has(id) || typeof title !== 'string'
      || !title.trim() || title.length > 80 || (date !== null && !isDate(date)) || !isSize(width) || !isSize(height)) {
      throw new Error('Invalid photo manifest');
    }
    ids.add(id);
    return { id, title, date, width, height };
  });
  if (featured.length > featuredPhotoCount || new Set(featured).size !== featured.length
    || !featured.every(id => typeof id === 'string' && ids.has(id))) {
    throw new Error('Invalid photo manifest');
  }
  return { version: 1, featured: featured as string[], photos: parsed };
}

/** The homepage picks, falling back to the first photos when none are chosen. */
export function featuredPhotos(manifest: PhotoManifest): PrivatePhoto[] {
  if (manifest.featured.length === 0) return manifest.photos.slice(0, featuredPhotoCount);
  return manifest.featured.map(id => manifest.photos.find(photo => photo.id === id)!);
}

export function photoSummary(count: number): string {
  return count === 0 ? '还没有照片。' : `${count} 张我们的照片。`;
}
