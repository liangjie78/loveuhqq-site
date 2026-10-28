// Checks on the built site in dist/ (run after `npm run build`).
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hundredDayLetter } from '../../worker/letter.ts';

const dist = fileURLToPath(new URL('../../dist', import.meta.url));
const pages = { home: 'index.html', album: 'photos/index.html', memories: 'memories/index.html', lost: '404.html' };
const read = path => readFileSync(join(dist, path), 'utf8');
const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

before(() => {
  assert.ok(existsSync(join(dist, 'index.html')), 'run `npm run build` first');
});

describe('every page', () => {
  test('exists, is Chinese, unindexed, and has a skip link to main', () => {
    for (const [name, path] of Object.entries(pages)) {
      const html = read(path);
      assert.match(html, /<html lang="zh-CN"/, name);
      assert.match(html, /<meta name="robots" content="noindex, nofollow"/, name);
      assert.match(html, /href="#main"/, name);
      assert.match(html, /id="main"/, name);
    }
  });

  test('loads nothing from other hosts (the CSP only allows this origin)', () => {
    for (const [name, path] of Object.entries(pages)) {
      const html = read(path);
      const external = [...html.matchAll(/<(?:script|link|img)[^>]+(?:src|href)="(https?:\/\/[^"]+)"/g)]
        .map(match => match[1])
        .filter(url => !/rel="(?:canonical|manifest|icon)"/.test(url));
      const loaded = external.filter(url => !url.startsWith('https://loveuhqq.x23.shop/'));
      assert.deepEqual(loaded, [], name);
    }
  });

  test('ships its fonts from this origin', () => {
    const css = walk(join(dist, '_assets')).filter(path => path.endsWith('.css')).map(path => readFileSync(path, 'utf8')).join('\n');
    const fonts = [...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map(match => match[1].replace(/^["']|["']$/g, ''));
    assert.ok(fonts.length >= 3);
    for (const font of fonts) assert.ok(existsSync(join(dist, font.replace(/^\//, ''))), font);
  });
});

describe('the journal', () => {
  const html = () => read(pages.home);

  test('keeps the confirmed words', () => {
    for (const words of ['爱你，何青青。', '一天，', '记一格。', '照片墙', '纪念我们走过的每一天', '记录生活，', '慢慢往前走。', '平平淡淡，', '踏实过好每一天。', '往后的日子', '也想和你一起', '共同回忆册', '往后。', '未完待续。']) {
      assert.ok(html().includes(words) || html().includes([...words].join('</span><span class="cover-ch"')), words);
    }
  });

  test('keeps the five chapter links', () => {
    for (const label of ['日子', '照片', '心里话', '往后', '信']) assert.match(html(), new RegExp(`data-nav-link[^>]*>${label}<`));
  });

  test('never hands out the gate answer in share previews', () => {
    for (const path of Object.values(pages)) {
      const head = read(path).split('</head>')[0];
      const shared = [...head.matchAll(/<meta (?:name|property)="(?:description|og:[^"]+|twitter:[^"]+)" content="([^"]*)"/g)].map(match => match[1]).join(' ');
      assert.doesNotMatch(shared, /07[.\-]?01/, path);
    }
  });

  test('does not write today\'s count into the static page', () => {
    assert.match(html(), /data-count-up[^>]*>0</);
  });
});

describe('privacy', () => {
  test('the hundred-day letter is nowhere in the static files', () => {
    const files = walk(dist).filter(path => /\.(html|js|css|json|txt)$/.test(path));
    const secrets = [...hundredDayLetter.paragraphs];
    for (const path of files) {
      const text = readFileSync(path, 'utf8');
      for (const secret of secrets) assert.ok(!text.includes(secret), `${path} contains private letter text`);
    }
  });

  test('security headers are shipped with the assets', () => {
    const headers = read('_headers');
    assert.match(headers, /Content-Security-Policy: default-src 'self'/);
    assert.match(headers, /X-Frame-Options: DENY/);
    assert.match(headers, /\/_assets\/\*\n\s+! Cache-Control\n\s+Cache-Control: public, max-age=31536000, immutable/);
  });
});
