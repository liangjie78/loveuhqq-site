import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

test('the saved moment picture is an openable 1200px PNG', () => {
  const png = readFileSync(new URL('../docs/previews/moments-png.png', import.meta.url));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  let offset = 8;
  let width = 0;
  let height = 0;
  const imageData = [];
  let ended = false;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === 'IDAT') imageData.push(data);
    offset += length + 12;
    if (type === 'IEND') { ended = true; break; }
  }

  assert.equal(width, 1200);
  assert.equal(height, 1400);
  assert.equal(ended, true);
  assert.ok(imageData.length > 0);
  assert.ok(inflateSync(Buffer.concat(imageData)).length > width * height);
});
