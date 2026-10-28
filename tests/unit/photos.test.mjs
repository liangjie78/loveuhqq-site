// The private album: manifest rules and the client-side upload preparation.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../helpers/bundle.mjs';

const photos = await load('src/lib/photos.ts');
const upload = await load('src/lib/photo-upload.ts');
const photo = (id, date, title = id) => ({ id: id.padEnd(16, '0'), title, date, width: 800, height: 1000 });

describe('manifest', () => {
  test('photos sort by date, undated last', () => {
    const sorted = photos.sortPhotos([photo('b', '2026-09-01'), photo('c', null), photo('a', '2026-07-02')]);
    assert.deepEqual(sorted.map(item => item.id[0]), ['a', 'b', 'c']);
  });

  test('featured picks only point at photos that exist, at most three', () => {
    const manifest = photos.parsePhotoManifest({ version: 1, revision: 4, featured: [photo('a', null).id, photo('b', null).id], photos: [photo('a', null), photo('b', null)] });
    assert.deepEqual(photos.featuredPhotos(manifest).map(item => item.id[0]), ['a', 'b']);
    assert.throws(() => photos.parsePhotoManifest({ version: 1, revision: 1, featured: [photo('z', null).id], photos: [] }));
  });

  test('the summary reads naturally', () => {
    assert.equal(photos.photoSummary(0), '还没有照片。');
    assert.equal(photos.photoSummary(6), '6 张我们的照片。');
  });
});

describe('upload preparation', () => {
  test('titles come from the file name', () => {
    assert.equal(upload.titleFromFileName('海边.JPG'), '海边');
    assert.equal(upload.titleFromFileName(`${'长'.repeat(100)}.png`).length, 80);
  });

  test('the capture date is read from EXIF when present', () => {
    const exif = new TextEncoder().encode('....Exif....2026:08:15 18:30:00....').buffer;
    assert.equal(upload.exifDateFromBytes(exif), '2026-08-15');
    assert.equal(upload.exifDateFromBytes(new TextEncoder().encode('0000:00:00 00:00:00').buffer), null);
    assert.equal(upload.exifDateFromBytes(new ArrayBuffer(8)), null);
  });

  test('re-encoded sizes keep the ratio and never upscale', () => {
    assert.deepEqual(upload.fitWithin(4000, 3000, 1800, 1800), { width: 1800, height: 1350 });
    assert.deepEqual(upload.fitWithin(600, 900, 800, 1000), { width: 600, height: 900 });
  });

  test('the photo id is a stable 16-hex digest of the original bytes', async () => {
    const bytes = new TextEncoder().encode('same picture').buffer;
    const id = await upload.sha16(bytes);
    assert.match(id, /^[a-f0-9]{16}$/);
    assert.equal(id, await upload.sha16(bytes));
  });

  test('the album balances its columns by height', () => {
    const columns = upload.balanceColumns(['tall', 'wide', 'wide', 'wide'], [.5, 2, 2, 2], 2);
    assert.deepEqual(columns, [['tall'], ['wide', 'wide', 'wide']]);
    assert.equal(upload.balanceColumns([1, 2, 3], [1, 1, 1], 3).every(column => column.length === 1), true);
  });
});
