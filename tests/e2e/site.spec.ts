import { expect, test, type Page } from '@playwright/test';
import { signedIn } from './session';

/*
 * End-to-end smoke for the rebuilt site against a local Worker with real D1/KV.
 * Runs once on a desktop viewport and once on a phone.
 */

const password = process.env.E2E_PASSWORD ?? 'e2e-only-password';
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Use the shared session; already-visited readers are not stopped by the gate on load. */
function signIn() {
  test.use({ storageState: signedIn });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.setItem('loveuhqq_visited', 'yes'); } catch { /* Storage is optional. */ } });
  });
}

function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/401|Failed to load resource/.test(message.text())) problems.push(message.text()); });
  return problems;
}

test.describe('gate', () => {
  test('asks the date, then the password, then opens the journal', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto('/');
    const gate = page.locator('[data-gate]');
    await expect(gate).toBeVisible();
    await expect(page.locator('#gate-title')).toContainText('是从哪天开始的');
    const code = page.locator('[data-gate-input]');
    await code.fill('0101');
    await expect(page.locator('[data-gate-error]')).toHaveText('好像不对，再想想。');
    await code.fill('0701');
    await expect(page.locator('[data-gate-password-panel]')).toBeVisible();
    await page.locator('[data-gate-password]').fill(password);
    await page.locator('[data-gate-password]').press('Enter');
    await expect(gate).toBeHidden();
    await expect(page.locator('[data-session-logout]')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('a visitor can look around; private parts stay locked', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-gate-visit]').click();
    await expect(page.locator('[data-gate]')).toBeHidden();
    await expect(page.locator('[data-open-login]').first()).toBeVisible();
    await expect(page.locator('[data-note-guest]')).toBeVisible();
    await expect(page.locator('[data-photos-locked]').first()).toBeVisible();
    await expect(page.locator('[data-photo-wall="featured"] .frame-empty')).toHaveCount(3);
  });

  test('Escape lets a visitor in, and a locked page reopens the gate', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-gate]')).toBeHidden();
    await page.locator('[data-note-guest] [data-open-login]').click();
    await expect(page.locator('[data-gate]')).toBeVisible();
  });
});

test.describe('journal', () => {
  signIn();

  test('the calendar answers the keyboard and the day can be written on', async ({ page, isMobile }) => {
    await page.goto('/#days');
    const grid = page.locator('[data-year-grid]');
    const readout = page.locator('[data-year-readout]');
    await grid.focus();
    const before = await readout.textContent();
    await page.keyboard.press(isMobile ? 'ArrowUp' : 'ArrowLeft');
    await expect(readout).not.toHaveText(before ?? '');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-note-private]')).toBeVisible();
    const words = `端到端 ${unique()}`;
    await page.locator('[data-note-edit]').click();
    await page.locator('#day-note').fill(words);
    await page.getByRole('button', { name: '收好这一句' }).click();
    await expect(page.locator('[data-note-status]')).toHaveText('收好了。');
    await expect(page.locator('[data-note-text]')).toHaveText(words);
  });

  test('the list for later adds and ticks off a wish', async ({ page }) => {
    await page.goto('/#future');
    const wish = `一起做的事 ${unique()}`;
    await page.locator('#wish-text').fill(wish);
    await page.getByRole('button', { name: '记上' }).click();
    const row = page.locator('.wish', { hasText: wish });
    await expect(row).toBeVisible();
    await row.locator('input.tick').check();
    await expect(page.locator('[data-wish-status]')).toHaveText('这一件，做到了。');
    await expect(row).toHaveClass(/is-done/);
    await expect(row.locator('input.tick')).toBeEnabled({ timeout: 1500 });
    await row.locator('input.tick').uncheck();
    await expect(page.locator('[data-wish-status]')).toHaveText('放回待做的清单。');
    await expect(row).not.toHaveClass(/is-done/);
  });

  test('the hundred-day letter opens after its day and closes back to the envelope', async ({ page }) => {
    await page.goto('/#letter');
    // The envelope floats gently forever, so it is never "stable" for Playwright.
    await page.locator('[data-envelope]').click({ force: true });
    const dialog = page.locator('[data-letter-dialog]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-letter-reading] p').first()).toBeVisible();
    await dialog.getByRole('button', { name: /收好这封信/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-envelope]')).toBeFocused();
  });
});

test.describe('photos', () => {
  signIn();
  test('an uploaded photo shows on the album and in the lightbox', async ({ page }) => {
    // A tiny WebP made in the page, posted through the same API the album uses.
    await page.goto('/photos/');
    await expect(page.locator('[data-photos-summary]')).not.toHaveText('解锁后，才能翻开这本相册。');
    const title = `Test${'A'.repeat(60)}${unique()}`;
    const status = await page.evaluate(async name => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 40, height: 50 });
      canvas.getContext('2d')!.fillRect(0, 0, 40, 50);
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/webp'));
      const manifest = await (await fetch('/api/photos')).json();
      const id = [...crypto.getRandomValues(new Uint8Array(8))].map(value => value.toString(16).padStart(2, '0')).join('');
      const form = new FormData();
      Object.entries({ title: name, date: '2026-08-15', id, expectedRevision: String(manifest.revision), width: '40', height: '50' }).forEach(([key, value]) => form.set(key, value));
      form.set('thumb', blob, 'thumb.webp'); form.set('large', blob, 'large.webp');
      return (await fetch('/api/photos', { method: 'POST', body: form })).status;
    }, title);
    expect(status).toBe(200);
    await page.reload();
    const print = page.locator(`[data-photo-wall="all"] a[aria-label^="${title}"]`);
    await print.scrollIntoViewIfNeeded();
    await print.click();
    const lightbox = page.locator('[data-lightbox]');
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator('[data-lightbox-title]')).toHaveText(title);
    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
    await expect(print).toBeFocused();
    await print.click();
    await lightbox.locator('[data-lightbox-delete]').click();
    await page.getByRole('button', { name: '确认取下' }).click();
    await expect(print).toHaveCount(0);
    const removed = page.locator('[data-photos-removed]');
    await expect(removed).toBeVisible();
    await page.reload();
    await removed.locator('summary').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
    await removed.getByRole('button', { name: `恢复「${title}」` }).click();
    await expect(print).toBeVisible();
    await expect(print).toBeFocused();
  });
});

test.describe('memory book', () => {
  signIn();
  test('a signature is chosen and a story is written', async ({ page }) => {
    await page.goto('/memories/');
    const choose = page.locator('[data-memory-identity-unselected] [data-select-identity="one"]');
    // Wait until the book knows whether a signature is already chosen.
    await expect(page.locator('[data-memory-identity]:not([hidden]), [data-memory-identity-unselected]:not([hidden])')).toBeVisible();
    if (await choose.isVisible()) await choose.click();
    await expect(page.locator('[data-memory-identity]')).toBeVisible();
    await page.locator('[data-story-new]').click();
    const title = `故事 ${unique()}`;
    const form = page.locator('[data-story-form]');
    await form.locator('[name="title"]').fill(title);
    await form.locator('[name="text"]').fill('端到端测试写下的一页。');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
    await form.getByRole('button', { name: '收好故事' }).click();
    await expect(page.locator('[data-story-detail]')).toContainText(title);
  });

  test('multiple place links survive an edit and a wish saves in one request', async ({ page }) => {
    const key = unique();
    const stories = [`地点故事一 ${key}`, `地点故事二 ${key}`];
    const wishes = [`地点愿望一 ${key}`, `地点愿望二 ${key}`];
    await page.goto('/memories/');
    await expect(page.locator('[data-memory-identity]:not([hidden]), [data-memory-identity-unselected]:not([hidden])')).toBeVisible();
    const choose = page.locator('[data-memory-identity-unselected] [data-select-identity="one"]');
    if (await choose.isVisible()) await choose.click();
    await expect(page.locator('[data-memory-identity]')).toBeVisible();
    const put = (path: string, data: unknown) => page.request.put(path, { data, headers: { Origin: new URL(page.url()).origin } });
    for (let index = 0; index < 2; index++) {
      expect((await put(`/api/wishes/wish-${key}-${index}`, { expectedVersion: 0, text: wishes[index], done: false })).ok()).toBe(true);
      expect((await put(`/api/memory/stories/story-${key}-${index}`, {
        expectedVersion: 0, title: stories[index], date: '2026-08-15', text: '合成测试正文', photoIds: [], wishIds: index === 0 ? [`wish-${key}-0`] : [], layout: 'journal', revealTogether: false,
      })).ok()).toBe(true);
    }
    await page.reload();
    await page.locator('[data-place-new]').click();
    const form = page.locator('[data-place-form]');
    await form.locator('[name="name"]').fill(`合成地点 ${key}`);
    for (const title of [...stories, ...wishes]) await form.getByRole('checkbox', { name: title }).check();
    await form.getByRole('button', { name: '收好地点' }).click();
    const place = page.locator('[data-place-id]', { hasText: `合成地点 ${key}` });
    await place.getByRole('button', { name: '改这个地点' }).click();
    for (const title of [...stories, ...wishes]) await expect(form.getByRole('checkbox', { name: title })).toBeChecked();
    await form.locator('[name="name"]').fill(`合成地点改名 ${key}`);
    await form.getByRole('button', { name: '收好地点' }).click();
    const renamed = page.locator('[data-place-id]', { hasText: `合成地点改名 ${key}` });
    for (const title of [...stories, ...wishes]) await expect(renamed).toContainText(title);

    const card = page.locator('[data-memory-wish-id]', { hasText: wishes[0] });
    await card.getByRole('button', { name: '安排这件事' }).click();
    await card.locator('input[type=date]').fill('2026-12-01');
    await card.getByRole('checkbox').check();
    const writes: string[] = [];
    page.on('request', request => { if (request.method() === 'PUT') writes.push(new URL(request.url()).pathname); });
    await card.getByRole('button', { name: '收好安排与关联' }).click();
    await expect(card).toContainText('已经做过 · 商定在 2026-12-01');
    expect(writes).toEqual([`/api/memory/wishPlans/wish-${key}-0`]);

    await page.locator('[data-story-list]').getByRole('button', { name: new RegExp(stories[0]) }).click();
    const detail = page.locator('[data-story-detail]');
    await detail.getByRole('button', { name: '安排这件事' }).click();
    const pendingPlan = detail.locator('form.memory-wish-plan');
    await pendingPlan.locator('input[type=date]').fill('2026-12-03');
    await detail.getByRole('button', { name: '写自己的版本' }).click();
    const part = detail.locator('[data-part-form]');
    await part.getByRole('textbox', { name: '我记得的这一页' }).fill('个人版本已保存');
    await part.getByRole('button', { name: '收好自己的版本' }).click();
    await expect(detail.getByRole('button', { name: '写自己的版本' })).toBeVisible();
    await expect(detail.locator('[data-part-member="one"]')).toContainText('个人版本已保存');
    await expect(pendingPlan.locator('input[type=date]')).toHaveValue('2026-12-03');
  });

  test('a recording being discarded cannot be saved into a story', async ({ page }) => {
    await page.goto('/memories/');
    await expect(page.locator('[data-memory-identity]:not([hidden]), [data-memory-identity-unselected]:not([hidden])')).toBeVisible();
    const choose = page.locator('[data-memory-identity-unselected] [data-select-identity="one"]');
    if (await choose.isVisible()) await choose.click();
    await page.locator('[data-story-new]').click();
    const story = page.locator('[data-story-form]');
    await story.locator('[name="title"]').fill(`录音测试 ${unique()}`);
    await story.getByRole('button', { name: '收好故事' }).click();
    await page.locator('[data-story-detail]').getByRole('button', { name: '写自己的版本' }).click();
    const part = page.locator('[data-part-form]');
    const file = part.getByLabel('上传已有录音');
    const wav = Buffer.alloc(44 + 8_000);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8_000, 24); wav.writeUInt32LE(8_000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
    wav.write('data', 36); wav.writeUInt32LE(8_000, 40); wav.fill(128, 44);
    await file.setInputFiles({ name: 'fixture.wav', mimeType: 'audio/wav', buffer: wav });
    await part.getByRole('button', { name: '收进这一页' }).click();
    const discard = part.getByRole('button', { name: '丢弃录音 1' });
    const save = part.getByRole('button', { name: '收好自己的版本' });
    let releaseDelete: () => void = () => {};
    const delayed = new Promise<void>(resolve => { releaseDelete = resolve; });
    let audioPath = '';
    await page.route('**/api/memory/audio/*', async route => {
      if (route.request().method() === 'DELETE') {
        audioPath = new URL(route.request().url()).pathname;
        await delayed;
      }
      await route.continue();
    });
    await discard.click();
    await expect.poll(() => audioPath).toMatch(/\/api\/memory\/audio\//);
    await save.click();
    await expect(part.getByRole('status').last()).toHaveText('录音还在处理，请稍后再保存。');
    releaseDelete();
    await expect(file).toBeFocused();
    expect((await page.request.get(audioPath)).status()).toBe(404);
    const saved = page.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith('/part'));
    await part.getByRole('textbox', { name: '我记得的这一页' }).fill('只保存文字');
    await save.click();
    expect((await saved).postDataJSON().audioIds).toEqual([]);
    await expect(page.locator('[data-story-detail]')).toContainText('只保存文字');
  });

  test('a desktop note can be removed and restored with the keyboard', async ({ page }) => {
    await page.goto('/memories/');
    await expect(page.locator('[data-memory-identity]:not([hidden]), [data-memory-identity-unselected]:not([hidden])')).toBeVisible();
    const choose = page.locator('[data-memory-identity-unselected] [data-select-identity="one"]');
    if (await choose.isVisible()) await choose.click();
    const desk = page.locator('[data-shared-desktop]');
    await expect(desk.getByRole('status').first()).toContainText('已连接');
    const title = `测试桌面便签 ${unique()} ${'较长的测试正文，'.repeat(15)} 最后一行。`;
    await desk.getByRole('textbox', { name: '便签或票根内容' }).fill(title);
    await desk.getByRole('button', { name: '贴便签' }).click();
    const note = desk.locator('[data-desk-id]', { hasText: title });
    await note.getByRole('button', { name: '查看' }).click();
    await expect(desk.getByRole('dialog')).toContainText('最后一行。');
    await desk.getByRole('button', { name: '收起' }).click();
    await note.getByRole('button', { name: `取下「${title}」` }).press('Enter');
    await expect(note).toHaveCount(0);
    const undo = desk.getByRole('button', { name: '撤销取下' });
    await expect(undo).toBeFocused();
    await undo.press('Enter');
    await expect(note).toBeFocused();
    await expect(undo).toBeHidden();
  });
});

test('signing in from the locked memory book unlocks it', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/memories/');
  await page.locator('[data-gate-visit]').click();
  await page.locator('#stories [data-open-login]').click();
  await page.locator('[data-gate-input]').fill('0701');
  await expect(page.locator('[data-gate-password-panel]')).toBeVisible();
  await page.locator('[data-gate-password]').fill(password);
  await page.locator('[data-gate-password]').press('Enter');
  await expect(page.locator('[data-gate]')).toBeHidden();
  await expect(page.locator('[data-memory-locked]')).toBeHidden();
  await expect(page.locator('[data-memory-identity]:not([hidden]), [data-memory-identity-unselected]:not([hidden])')).toBeVisible();
  const choose = page.locator('#stories [data-section-identity]');
  await expect(choose).toBeVisible();
  await expect(page.locator('#stories [data-section-guest]')).toBeHidden();
  await choose.locator('[data-select-identity="one"]').click();
  await expect(page.locator('#stories [data-section-private]')).toBeVisible();
  // The fixed header tucks away while reading down; return to the top as a reader would.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(page.locator('[data-header]')).not.toHaveClass(/is-tucked/);
  await page.locator('[data-session-logout]').click();
  await expect(page.locator('#stories [data-section-guest]')).toBeVisible();
  await expect(choose).toBeHidden();
  await expect(page.locator('#stories [data-section-private]')).toBeHidden();
  expect(problems).toEqual([]);
});

test.describe('every page, signed in', () => {
  signIn();
  for (const path of ['/', '/photos/', '/memories/', '/no-such-page']) {
    test(`${path} fits the screen and logs no errors`, async ({ page }) => {
      const problems = watchConsole(page);
      const response = await page.goto(path);
      if (path === '/no-such-page') {
        expect(response?.status()).toBe(404);
        await expect(page.locator('h1')).toContainText('这一页，好像被撕掉了。');
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(problems).toEqual([]);
    });
  }
});

test.describe('every page, as a visitor', () => {
  test('chapter navigation works without scripts', async ({ page }) => {
    await page.route('**/_assets/*.js', route => route.abort());
    await page.goto('/');
    const days = page.locator('[data-nav-link][href="#days"]');
    await expect(page.locator('html')).not.toHaveClass(/is-locked/);
    await expect(days).toBeVisible();
    await days.click();
    await expect(page).toHaveURL(/#days$/);
  });

  test('reduced motion shows the cover at once', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('[data-gate-visit]').click();
    await expect(page.locator('html')).toHaveClass(/is-open/);
    const opacity = await page.locator('.cover-ch').first().evaluate(element => getComputedStyle(element).opacity);
    expect(Number(opacity)).toBe(1);
    await expect(page.locator('html')).not.toHaveClass(/lenis/);
    await context.close();
  });

  test('the theme toggle remembers the night', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-gate-visit]').click();
    await page.locator('[data-theme-toggle]').click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#110d0c');
  });
});
