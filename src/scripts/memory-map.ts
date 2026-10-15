import type { MemoryPlace, MemoryStory } from '../lib/memory-book';

/** A small slippy map. Tiles load only while the private map is open, with normal browser caching. */
export function createMemoryMap(container: HTMLElement, options: {
  onPick: (lat: number, lng: number) => void;
  onOpenStory: (id: string) => void;
}) {
  const controls = document.createElement('div'); controls.className = 'memory-tool-actions';
  const viewport = document.createElement('div'); viewport.className = 'memory-map';
  viewport.tabIndex = 0; viewport.setAttribute('aria-label', '回忆地图，方向键移动，正负键缩放，点击空白处标记地点');
  const tiles = document.createElement('div'); tiles.className = 'memory-map-tiles';
  const pins = document.createElement('div'); pins.className = 'memory-map-pins';
  const status = document.createElement('p'); status.className = 'memory-tool-hint'; status.setAttribute('role', 'status');
  const attribution = document.createElement('a'); attribution.href = 'https://www.openstreetmap.org/copyright';
  attribution.textContent = '© OpenStreetMap contributors'; attribution.target = '_blank'; attribution.rel = 'noreferrer';
  attribution.className = 'memory-map-attribution';
  viewport.append(tiles, pins, attribution);
  let places: MemoryPlace[] = [], stories: MemoryStory[] = [];
  let zoom = 2, lat = 0, lng = 0, active = false, fitted = false;
  let rendered = '';
  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  const project = (a: number, b: number) => {
    const size = 256 * 2 ** zoom;
    const sine = Math.sin(Math.max(-85.0511, Math.min(85.0511, a)) * Math.PI / 180);
    return { x: (b + 180) / 360 * size, y: (.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size };
  };
  function unproject(x: number, y: number) {
    const size = 256 * 2 ** zoom;
    return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * Math.max(0, Math.min(size, y)) / size))) * 180 / Math.PI,
      lng: ((x / size * 360 + 180) % 360 + 360) % 360 - 180 };
  }
  function button(text: string, action: () => void) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'text-button'; b.textContent = text;
    b.addEventListener('click', action); controls.append(b); return b;
  }
  const zoomIn = button('放大 ＋', () => { zoom = Math.min(17, zoom + 1); draw(); });
  const zoomOut = button('缩小 −', () => { zoom = Math.max(1, zoom - 1); draw(); });
  button('标记地图中心', () => options.onPick(Number(lat.toFixed(6)), Number(lng.toFixed(6))));
  const details = document.createElement('div'); details.className = 'memory-map-detail';
  function openPlace(place: MemoryPlace) {
    details.replaceChildren();
    const heading = document.createElement('strong'); heading.textContent = place.name; details.append(heading);
    const coords = document.createElement('p'); coords.textContent = `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`; details.append(coords);
    for (const id of place.storyIds) {
      const story = stories.find(s => s.id === id); if (!story) continue;
      const link = document.createElement('button'); link.type = 'button'; link.className = 'text-button';
      link.textContent = `翻开「${story.title}」 ↗`; link.addEventListener('click', () => options.onOpenStory(id)); details.append(link);
    }
  }
  function draw() {
    if (!active) return;
    const width = viewport.clientWidth || 600, height = viewport.clientHeight || 360;
    const center = project(lat, lng), left = center.x - width / 2, top = center.y - height / 2;
    const count = 2 ** zoom, needed = new Set<string>();
    for (let x = Math.floor(left / 256); x <= Math.floor((left + width) / 256); x++) {
      for (let y = Math.floor(top / 256); y <= Math.floor((top + height) / 256); y++) {
        if (y < 0 || y >= count) continue;
        const key = `${zoom}/${x}/${y}`; needed.add(key);
        let tile = [...tiles.querySelectorAll<HTMLImageElement>('img')].find(i => i.dataset.tile === key);
        if (!tile) {
          tile = document.createElement('img'); tile.alt = ''; tile.width = tile.height = 256; tile.draggable = false; tile.dataset.tile = key;
          tile.referrerPolicy = 'strict-origin-when-cross-origin';
          tile.addEventListener('error', () => { if (active) status.textContent = '底图暂时没能加载，地点列表和手动坐标仍可使用。'; });
          tile.src = `https://tile.openstreetmap.org/${zoom}/${((x % count) + count) % count}/${y}.png`;
          tiles.append(tile);
        }
        tile.style.transform = `translate(${Math.round(x * 256 - left)}px, ${Math.round(y * 256 - top)}px)`;
      }
    }
    for (const tile of tiles.querySelectorAll<HTMLImageElement>('img')) if (!needed.has(tile.dataset.tile!)) { tile.removeAttribute('src'); tile.remove(); }
    pins.replaceChildren();
    for (const place of places) {
      const point = project(place.lat, place.lng);
      let dx = point.x - center.x; const world = 256 * count;
      if (dx > world / 2) dx -= world; if (dx < -world / 2) dx += world;
      const x = width / 2 + dx, y = point.y - top;
      if (x < -30 || x > width + 30 || y < -30 || y > height + 30) continue;
      const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'memory-map-pin';
      pin.textContent = '●'; pin.setAttribute('aria-label', place.name); pin.title = place.name;
      pin.style.left = `${x}px`; pin.style.top = `${y}px`;
      pin.addEventListener('click', e => { e.stopPropagation(); openPlace(place); }); pins.append(pin);
    }
    zoomIn.disabled = zoom >= 17; zoomOut.disabled = zoom <= 1;
  }
  viewport.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('button,a')) return;
    const c = project(lat, lng); drag = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y, moved: false }; viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    if (drag.moved) { const p = unproject(drag.cx - dx, drag.cy - dy); lat = p.lat; lng = p.lng; draw(); }
  });
  viewport.addEventListener('pointerup', e => {
    if (!drag) return;
    if (!drag.moved) {
      const box = viewport.getBoundingClientRect(), c = project(lat, lng);
      const p = unproject(c.x + e.clientX - box.left - box.width / 2, c.y + e.clientY - box.top - box.height / 2);
      options.onPick(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
    }
    drag = null;
  });
  viewport.addEventListener('pointercancel', () => { drag = null; });
  viewport.addEventListener('keydown', e => {
    if (e.target !== viewport) return;
    const movements: Record<string, [number, number]> = { ArrowLeft: [-100, 0], ArrowRight: [100, 0], ArrowUp: [0, -100], ArrowDown: [0, 100] };
    if (movements[e.key]) {
      e.preventDefault(); const c = project(lat, lng), [x, y] = movements[e.key]; const p = unproject(c.x + x, c.y + y); lat = p.lat; lng = p.lng; draw();
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn.click(); }
    else if (e.key === '-') { e.preventDefault(); zoomOut.click(); }
  });
  const resize = new ResizeObserver(draw); resize.observe(viewport);
  container.replaceChildren(controls, viewport, status, details);
  return {
    render(nextPlaces: MemoryPlace[], nextStories: MemoryStory[], year?: number) {
      const snapshot = JSON.stringify([nextPlaces, nextStories.map(story => [story.id, story.title, story.date]), year]);
      if (active && rendered === snapshot) return;
      rendered = snapshot;
      active = true;
      places = nextPlaces.filter(p => !year || p.year === year || p.storyIds.some(id => nextStories.some(s => s.id === id && Number(s.date.slice(0, 4)) === year)));
      stories = nextStories; status.textContent = '拖动地图浏览，点击空白处标记地点；也可以手动填写坐标。';
      if (!fitted && places.length) { lat = places[0].lat; lng = places[0].lng; zoom = 9; fitted = true; }
      details.replaceChildren(); draw();
    },
    focus(place: MemoryPlace) { lat = place.lat; lng = place.lng; zoom = Math.max(zoom, 10); draw(); openPlace(place); },
    clear() { active = false; fitted = false; rendered = ''; drag = null; places = []; stories = []; lat = lng = 0; zoom = 2;
      tiles.querySelectorAll('img').forEach(i => i.removeAttribute('src')); tiles.replaceChildren(); pins.replaceChildren(); details.replaceChildren(); status.textContent = ''; },
  };
}
