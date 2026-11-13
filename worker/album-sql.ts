import type { PhotoManifest } from '../src/lib/photos.ts';

export const albumRevisionSql = 'SELECT revision FROM album_state WHERE id = 1';
export const legacyAlbumSql = 'SELECT manifest, revision FROM photo_manifest WHERE id = 1';
export const albumClock = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";
export const uploadGraceMs = 24 * 60 * 60 * 1000;

/** Small statements work with both D1 batch() and the bulk uploader's SQL file. */
export function albumInitialization(manifest: PhotoManifest): { sql: string; args: (string | number)[] }[] {
  const statements = [];
  for (let i = 0; i < manifest.photos.length; i += 100) {
    const chunk = manifest.photos.slice(i, i + 100).map(photo => ({
      ...photo, rank: manifest.featured.indexOf(photo.id) + 1 || null,
    }));
    statements.push({
      sql: `INSERT INTO album_photos (id, object_id, title, date, width, height, featured_rank)
        SELECT value->>'id', value->>'id', value->>'title', value->>'date', value->>'width', value->>'height', value->>'rank'
        FROM json_each(?) WHERE NOT EXISTS (SELECT 1 FROM album_state WHERE id = 1)`,
      args: [JSON.stringify(chunk)],
    });
  }
  statements.push({ sql: 'INSERT OR IGNORE INTO album_state (id, revision) VALUES (1, ?)', args: [manifest.revision] });
  return statements;
}
