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
    const title = `测试 ${unique()}`;
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
  });
});

test.describe('memory book', () => {
  signIn();
  test('a signature is chosen and a story is written', async ({ page }) => {
    await page.goto('/memories/');
    const choose = page.locator('[data-select-identity="one"]');
    // Wait until the book knows whether a signature is already chosen.
    await expect(page.locator('[data-memory-identity]:not([hidden]), [data-memory-identity-unselected]:not([hidden])')).toBeVisible();
    if (await choose.isVisible()) await choose.click();
    await expect(page.locator('[data-memory-identity]')).toBeVisible();
    await page.locator('[data-story-new]').click();
    const title = `故事 ${unique()}`;
    const form = page.locator('[data-story-form]');
    await form.locator('[name="title"]').fill(title);
    await form.locator('[name="text"]').fill('端到端测试写下的一页。');
    await form.getByRole('button', { name: '收好故事' }).click();
    await expect(page.locator('[data-story-detail]')).toContainText(title);
  });
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
