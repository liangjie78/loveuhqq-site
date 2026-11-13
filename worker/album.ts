import { emptyPhotoManifest, parsePhotoManifest, photoManifestKey, photoRestoreMs, photoObjectKey, photoSizes, sortPhotos } from '../src/lib/photos.ts';
import type { PhotoManifest, PrivatePhoto, RemovedPhoto } from '../src/lib/photos.ts';
import { albumClock, albumInitialization, albumRevisionSql, legacyAlbumSql } from './album-sql.ts';

export async function initializeAlbum(db: D1Database, store: KVNamespace | undefined) {
  const row = await db.prepare(legacyAlbumSql).first<{ manifest: string; revision: number }>();
  const raw = row ? { ...JSON.parse(row.manifest), revision: row.revision } : await store?.get(photoManifestKey, 'json');
  const manifest = raw == null ? emptyPhotoManifest() : parsePhotoManifest(raw);
  // Every statement checks for an initialized album inside the same transaction.
  await db.batch(albumInitialization(manifest).map(({ sql, args }) => db.prepare(sql).bind(...args)));
}

export async function ensureAlbum(db: D1Database, store: KVNamespace | undefined) {
  if (!await db.prepare(albumRevisionSql).first()) await initializeAlbum(db, store);
}

export async function readAlbum(db: D1Database, store: KVNamespace | undefined, includeRemoved = false): Promise<PhotoManifest & { removed?: RemovedPhoto[] }> {
  const query = [db.prepare(albumRevisionSql), db.prepare('SELECT id, title, date, width, height, featured_rank FROM album_photos WHERE removed_at IS NULL')];
  if (includeRemoved) query.push(db.prepare(`SELECT id, title, removed_at + ? AS restoreUntil
    FROM album_photos WHERE removed_at > ${albumClock} - ? ORDER BY removed_at DESC`).bind(photoRestoreMs, photoRestoreMs));
  let [state, rows, removed] = await db.batch(query);
  if (!state.results.length) {
    await initializeAlbum(db, store);
    [state, rows, removed] = await db.batch(query);
  }
  const entries = rows.results as (PrivatePhoto & { featured_rank: number | null })[];
  const { revision } = state.results[0] as { revision: number };
  return {
    version: 1, revision,
    featured: entries.filter(photo => photo.featured_rank !== null).sort((a, b) => a.featured_rank! - b.featured_rank!).map(photo => photo.id),
    photos: sortPhotos(entries.map(({ id, title, date, width, height }) => ({ id, title, date, width, height }))),
    ...(includeRemoved ? { removed: removed.results as RemovedPhoto[] } : {}),
  };
}

export async function activePhotoObject(db: D1Database, store: KVNamespace | undefined, id: string) {
  const query = db.prepare(`SELECT (SELECT object_id FROM album_photos WHERE id = ? AND removed_at IS NULL) AS object_id
    FROM album_state WHERE id = 1`).bind(id);
  let row = await query.first<{ object_id: string | null }>();
  if (!row) { await initializeAlbum(db, store); row = await query.first<{ object_id: string | null }>(); }
  return row?.object_id ?? null;
}

export async function sweepAlbum(db: D1Database, store: KVNamespace) {
  const [removed, uploads] = await db.batch<{ object_id: string }>([
    db.prepare(`SELECT object_id FROM album_photos WHERE removed_at <= ${albumClock} - ?
      ORDER BY removed_at LIMIT 4`).bind(photoRestoreMs),
    db.prepare(`SELECT object_id FROM album_uploads WHERE expires_at <= ${albumClock} ORDER BY expires_at LIMIT 2`),
  ]);
  const remove = async (objectId: string) => {
    const results = await Promise.allSettled(photoSizes.map(size => store.delete(photoObjectKey(objectId, size))));
    if (results.some(result => result.status === 'rejected')) throw new Error('Photo bytes could not be reclaimed');
  };
  const results = await Promise.allSettled([
    ...removed.results.map(async ({ object_id }) => {
      await remove(object_id);
      await db.prepare('DELETE FROM album_photos WHERE object_id = ? AND removed_at IS NOT NULL').bind(object_id).run();
    }),
    ...uploads.results.map(async ({ object_id }) => {
      await remove(object_id);
      await db.prepare('DELETE FROM album_uploads WHERE object_id = ?').bind(object_id).run();
    }),
  ]);
  if (results.some(result => result.status === 'rejected')) throw new Error('Some album objects could not be reclaimed');
}
