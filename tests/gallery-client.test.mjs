import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const source = new URL('../src/scripts/gallery.ts', import.meta.url);
const compiled = await build({
  stdin: {
    contents: `${await readFile(source, 'utf8')}\nexport { open, applyManifest };`,
    resolveDir: fileURLToPath(new URL('../src/scripts/', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, write: false, format: 'cjs', platform: 'browser',
  plugins: [{
    name: 'album-transport',
    setup(builder) {
      builder.onResolve({ filter: /\/lib\/(session|cloud-notebook)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onResolve({ filter: /\/lib\/lucide-dom$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /session$/, namespace: 'fixture' }, () => ({ contents: `
        export const onSessionChange = listener => globalThis.sessionListener = listener;
        export const getSession = async () => ({});
        export const publishSession = () => {};
      ` }));
      builder.onLoad({ filter: /cloud-notebook$/, namespace: 'fixture' }, () => ({ contents: `
        export class ApiError extends Error {}
        export const api = async () => globalThis.manifest;
      ` }));
      builder.onLoad({ filter: /lucide-dom$/, namespace: 'fixture' }, () => ({ contents: `
        export function lucideSvg() { return document.createElement('span'); }
      ` }));
    },
  }],
});

const photos = ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc'].map((id, i) => ({
  id, title: `合成照片 ${i + 1}`, date: null, width: 800, height: 600,
}));
const settle = () => new Promise(resolve => setImmediate(resolve));

async function fixture() {
  const elements = new Map(), images = [];
  let document;
  class Element extends EventTarget {
    constructor() {
      super();
      this.children = []; this.dataset = {}; this.hidden = false; this.disabled = false;
      this.textContent = ''; this.value = ''; this.style = { setProperty() {} };
      const classes = new Set();
      this.classList = { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key) };
    }
    querySelector(selector) { return elements.get(selector) ?? null; }
    querySelectorAll() { return []; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    replaceWith(next) { elements.set('[data-lightbox-image]', next); }
    focus() { document.activeElement = this; }
    select() {}
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent(new Event('close')); }
  }
  class Image extends Element {
    constructor() {
      super(); this.complete = false;
      this.ready = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
      images.push(this);
    }
    decode() { return this.ready; }
  }
  const selectors = [
    '[data-lightbox]', '.lightbox-print', '[data-lightbox-image]', '[data-lightbox-title]', '[data-lightbox-meta]',
    '[data-photo-stories]', '[data-lightbox-prev]', '[data-lightbox-next]', '[data-lightbox-close]',
    '[data-lightbox-feedback]', '[data-lightbox-status]', '[data-lightbox-retry]', '[data-lightbox-management]',
    '[data-lightbox-edit]', '[data-lightbox-feature]', '[data-lightbox-delete]', '[data-photo-manage]',
    '[data-photo-edit-panel]', '[data-photo-delete-panel]', '[data-photo-title-input]',
  ];
  selectors.forEach(selector => elements.set(selector, new Element()));
  const wall = new Element();
  wall.dataset.photoWall = 'all';
  document = Object.assign(new EventTarget(), {
    documentElement: new Element(),
    createElement: () => new Element(),
    querySelector: selector => elements.get(selector) ?? null,
    querySelectorAll: selector => selector === '[data-photo-wall]' ? [wall] : [],
  });
  const sandbox = {
    module: { exports: {} }, document, Image, AbortController,
    window: Object.assign(new EventTarget(), { setTimeout, clearTimeout }),
    manifest: { version: 1, revision: 1, featured: [], photos },
  };
  vm.runInNewContext(compiled.outputFiles[0].text, sandbox);
  sandbox.sessionListener({ authenticated: true });
  await settle();
  const get = selector => elements.get(selector);
  const trigger = new Element();
  const open = target => sandbox.module.exports.open(photos, target, trigger, 'all');
  const ready = async image => { image.resolve(); await settle(); };
  return { get, open, images, ready, trigger, document, applyManifest: sandbox.module.exports.applyManifest };
}

test('a pending or failed next image cannot retarget photo management', async () => {
  const f = await fixture();
  f.open(0);
  await f.ready(f.images[0]);
  assert.equal(f.get('[data-lightbox-management]').hidden, false);
  f.get('[data-lightbox-next]').click();
  assert.equal(f.get('[data-lightbox-title]').textContent, photos[0].title);
  assert.equal(f.get('[data-lightbox-edit]').disabled, true);
  f.get('[data-lightbox-edit]').click();
  assert.equal(f.get('[data-photo-manage]').open, undefined);
  f.images[1].reject(new Error('offline'));
  await settle();
  assert.equal(f.get('[data-lightbox-title]').textContent, photos[0].title);
  assert.equal(f.get('[data-lightbox-retry]').hidden, false);
  f.get('[data-lightbox-retry]').click();
  await f.ready(f.images[2]);
  assert.equal(f.get('[data-lightbox-title]').textContent, photos[1].title);
  assert.equal(f.get('[data-lightbox-edit]').disabled, false);
  f.get('[data-lightbox-edit]').click();
  assert.equal(f.get('[data-photo-title-input]').value, photos[1].title);
});

test('a manifest response preserves the requested photo while its first image is pending', async () => {
  const f = await fixture();
  f.open(2);
  f.applyManifest({ version: 1, revision: 2, featured: [], photos });
  assert.equal(f.images[0].src, '');
  assert.equal(f.images[1].src, `/api/photos/${photos[2].id}/large`);
  await f.ready(f.images[1]);
  assert.equal(f.get('[data-lightbox-title]').textContent, photos[2].title);
  assert.equal(f.get('[data-lightbox-meta]').textContent, '3 / 3');
});

test('removing photos updates navigation for the remaining single print', async () => {
  const f = await fixture();
  f.open(2);
  await f.ready(f.images[0]);
  f.applyManifest({ version: 1, revision: 2, featured: [], photos: [photos[0]] });
  assert.equal(f.get('[data-lightbox-prev]').hidden, true);
  assert.equal(f.get('[data-lightbox-next]').hidden, true);
  await f.ready(f.images[1]);
  assert.equal(f.get('[data-lightbox-title]').textContent, photos[0].title);
  assert.equal(f.get('[data-lightbox-meta]').textContent, '1 / 1');
});

test('rapid navigation commits only the final image and cancels superseded requests', async () => {
  const f = await fixture();
  f.open(0);
  await f.ready(f.images[0]);
  f.get('[data-lightbox-next]').click();
  f.get('[data-lightbox-next]').click();
  assert.equal(f.images[1].src, '');
  await f.ready(f.images[2]);
  await f.ready(f.images[1]);
  assert.equal(f.get('[data-lightbox-title]').textContent, photos[2].title);
  assert.equal(f.get('[data-photo-stories]').href, `/memories/?photo=${photos[2].id}`);
  assert.equal(f.get('[data-lightbox-meta]').textContent, '3 / 3');
});

test('opening failure hides the previous print and closing prevents a late commit', async () => {
  const f = await fixture();
  f.open(0);
  await f.ready(f.images[0]);
  f.get('[data-lightbox]').close();
  f.open(1);
  assert.equal(f.get('[data-lightbox-image]').hidden, true);
  assert.equal(f.get('[data-photo-stories]').hidden, true);
  f.images[1].reject(new Error('offline'));
  await settle();
  assert.equal(f.get('[data-lightbox-retry]').hidden, false);
  assert.equal(f.get('[data-lightbox-management]').hidden, true);
  f.get('[data-lightbox-retry]').click();
  f.get('[data-lightbox]').close();
  assert.equal(f.images[2].src, '');
  await f.ready(f.images[2]);
  assert.equal(f.get('[data-lightbox-image]').hidden, true);
  assert.equal(f.document.activeElement, f.trigger);
});

test('only a completed single-finger swipe changes photos; pinch and cancelled touches do not', async () => {
  const f = await fixture();
  f.open(0);
  await f.ready(f.images[0]);
  const touch = (identifier, clientX) => ({ identifier, clientX, clientY: 200 });
  const dispatch = (name, touches, changedTouches = touches) => {
    f.get('[data-lightbox]').dispatchEvent(Object.assign(new Event(name), { touches, changedTouches }));
  };
  dispatch('touchstart', [touch(1, 300)]);
  dispatch('touchstart', [touch(1, 300), touch(2, 350)]);
  dispatch('touchend', [touch(2, 350)], [touch(1, 100)]);
  dispatch('touchend', [], [touch(2, 350)]);
  assert.equal(f.images.length, 1);
  dispatch('touchstart', [touch(1, 300)]);
  dispatch('touchcancel', [], [touch(1, 100)]);
  dispatch('touchend', [], [touch(1, 100)]);
  assert.equal(f.images.length, 1);
  dispatch('touchstart', [touch(1, 300)]);
  dispatch('touchend', [], [touch(1, 100)]);
  assert.equal(f.images.length, 2);
  await f.ready(f.images[1]);
  assert.equal(f.get('[data-lightbox-title]').textContent, photos[1].title);
});
