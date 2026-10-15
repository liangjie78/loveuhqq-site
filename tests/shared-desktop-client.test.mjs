import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Run the real client with only its browser transport/DOM boundary replaced.
// These tests cover message ordering and user recovery, not browser layout or workerd.
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/scripts/shared-desktop.ts', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'browser',
});

function fixture() {
  let document;
  class Element {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.listeners = new Map(); this.dataset = {}; this.style = {};
      this.attributes = new Map(); this.value = ''; this.hidden = false; this.textContent = '';
      this.clientWidth = 600; this.clientHeight = 400; this.parentElement = null;
    }
    append(...children) {
      for (const child of children) { if (child instanceof Element) child.parentElement = this; this.children.push(child); }
    }
    replaceChildren(...children) {
      this.children.forEach(child => { if (child instanceof Element) child.parentElement = null; });
      this.children = []; this.append(...children);
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); if (name === 'src') this.src = ''; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    dispatch(name, detail = {}) { this.listeners.get(name)?.({ target: this, preventDefault() {}, ...detail }); }
    focus() { document.activeElement = this; }
    matches(selector) {
      if (selector === '[data-desk-id]') return this.dataset.deskId !== undefined;
      const id = /^\[data-desk-id="([^"]+)"\]$/.exec(selector);
      return id ? this.dataset.deskId === id[1] : this.tagName === selector;
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
    querySelectorAll(selector) { return descendants(this).filter(node => node.matches(selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  }
  function descendants(root) {
    return root.children.flatMap(child => child instanceof Element ? [child, ...descendants(child)] : []);
  }
  document = { activeElement: null, createElement: tag => new Element(tag) };
  const sockets = [], timers = new Map(); let nextTimer = 0;
  class Socket {
    static OPEN = 1;
    constructor() { this.readyState = Socket.OPEN; this.listeners = new Map(); this.sent = []; this.closed = false; sockets.push(this); }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    send(value) { this.sent.push(JSON.parse(value)); }
    emit(message) { this.listeners.get('message')?.({ data: JSON.stringify(message) }); }
    open() { this.listeners.get('open')?.(); }
    close() { this.closed = true; this.readyState = 3; this.listeners.get('close')?.({ code: 1000 }); }
  }
  const sandbox = {
    module: { exports: {} }, document, WebSocket: Socket, ResizeObserver: class { observe() {} },
    location: { href: 'https://memory.example/memories/', protocol: 'https:' }, URL,
    crypto: globalThis.crypto, CSS: { escape: value => value },
    setInterval: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearInterval: id => timers.delete(id), clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(compiled.outputFiles[0].text, sandbox);
  const root = new Element('div');
  const client = sandbox.module.exports.createSharedDesktop(root, { onOpenStory() {}, onUnauthorized() {} });
  const member = { id: 'one', name: '合成作者' };
  client.update({ member, stories: [], photos: [] });
  const click = text => {
    const control = descendants(root).find(node => node.tagName === 'button' && node.textContent === text);
    assert.ok(control, `missing action: ${text}`); control.dispatch('click');
  };
  const card = id => descendants(root).find(node => node.dataset.deskId === id);
  const note = descendants(root).find(node => node.tagName === 'input');
  return { root, client, member, sockets, timers, descendants, click, card, note };
}

const item = { id: 'same-item', kind: 'note', refId: '', text: '合成便签', x: .2, y: .2, rotation: 0, version: 1 };
const snapshot = (revision, value = item) => ({ revision, items: [value], current: null });

test('another member saving the same object does not acknowledge my move; conflict retry keeps my position', () => {
  const f = fixture(), socket = f.sockets[0];
  socket.emit({ type: 'snapshot', state: snapshot(1) });
  f.card(item.id).dispatch('keydown', { key: 'ArrowRight' });
  const first = socket.sent.at(-1);
  assert.equal(first.type, 'put'); assert.ok(first.mutationId); assert.ok(first.item.x > item.x);
  const partnerItem = { ...item, x: .8, version: 2 };
  socket.emit({ type: 'saved', itemId: item.id, mutationId: 'other-members-operation', state: snapshot(2, partnerItem) });
  f.note.value = '下一张便签'; f.click('贴便签');
  assert.equal(socket.sent.length, 1, 'my unacknowledged move must still block a second save');
  socket.emit({ type: 'conflict', itemId: item.id, mutationId: first.mutationId, state: snapshot(2, partnerItem) });
  f.click('保留我的摆放再保存');
  const retry = socket.sent.at(-1);
  assert.equal(socket.sent.length, 2); assert.equal(retry.expectedVersion, 2);
  assert.equal(retry.item.x, first.item.x); assert.notEqual(retry.mutationId, first.mutationId);
  socket.emit({ type: 'saved', itemId: item.id, mutationId: retry.mutationId, state: snapshot(3, { ...retry.item, version: 3 }) });
  f.note.value = '确认后可以继续'; f.click('贴便签');
  assert.equal(socket.sent.length, 3, 'only my matching acknowledgement unlocks the next operation');
  f.client.clear();
});

test('manual reconnect preserves an unconfirmed move and allows retry against the recovered version', () => {
  const f = fixture(), old = f.sockets[0];
  old.emit({ type: 'snapshot', state: snapshot(1) });
  f.card(item.id).dispatch('keydown', { key: 'ArrowDown' });
  const first = old.sent.at(-1);
  f.click('重新连接'); assert.equal(old.closed, true);
  const replacement = f.sockets.at(-1); assert.notEqual(replacement, old);
  replacement.emit({ type: 'snapshot', state: snapshot(4, { ...item, x: .7, version: 4 }) });
  f.click('保留我的摆放再保存');
  const retry = replacement.sent.at(-1);
  assert.ok(retry, 'reconnect must not leave the client permanently busy');
  assert.equal(retry.expectedVersion, 4); assert.equal(retry.item.y, first.item.y);
  assert.notEqual(retry.mutationId, first.mutationId);
  f.client.clear();
});

test('clear closes the live connection, cancels timers and removes private photo/text DOM; late frames stay cleared', () => {
  const f = fixture(), socket = f.sockets[0];
  f.client.update({ member: f.member, stories: [], photos: [{ id: 'photo-a', title: '合成私密照片', width: 400, height: 300 }] });
  socket.open(); assert.ok(f.timers.size);
  const photo = { ...item, kind: 'photo', refId: 'photo-a' };
  const state = { ...snapshot(1, photo), current: { kind: 'photo', id: 'photo-a', memberId: 'two' } };
  socket.emit({ type: 'snapshot', state });
  const image = f.card(item.id).querySelector('img'); assert.ok(image.src);
  f.note.value = '尚未提交的私密便签';
  f.client.clear();
  assert.equal(socket.closed, true); assert.equal(f.timers.size, 0); assert.equal(image.src, '');
  assert.equal(f.root.querySelectorAll('img').length, 0); assert.equal(f.root.querySelectorAll('article').length, 0);
  assert.equal(f.root.querySelectorAll('option').length, 0); assert.equal(f.note.value, '');
  socket.emit({ type: 'snapshot', state });
  f.note.value = '锁定后点击'; f.click('贴便签');
  assert.equal(f.root.querySelectorAll('article').length, 0); assert.equal(socket.sent.length, 0);
  assert.equal(f.sockets.length, 1, 'clear must not schedule a replacement private connection');
});
