import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryExport } from '../src/lib/memory-export.ts';

const exportedAt = '2026-10-20T09:15:00.000Z';
const fixture = () => ({
  member: { id: 'one', name: '男生' },
  members: [{ id: 'one', name: '男生' }, { id: 'two', name: '女生' }],
  stories: [{
    id: 'story-1', version: 9, title: '一起记下', date: '2026-10-19', text: '第一行\n第二行，中文。',
    photoIds: ['private-photo'], wishIds: ['wish-1'], layout: 'journal', revealTogether: true, openedAt: null,
    parts: [
      { memberId: 'one', version: 4, submitted: false, text: '自己的版本\n继续写', reply: '', audioIds: ['private-audio'] },
      { memberId: 'two', version: 3, submitted: true },
    ],
  }],
  letters: [{
    id: 'letter-1', version: 5, senderId: 'one', recipientId: 'two', title: '未来的一页',
    openDate: '2026-10-19', pairKey: 'pair-1', status: 'sealed', sealedAt: 1234, readable: true,
    text: '信的第一行\n信的第二行', audioIds: ['private-audio'],
  }],
  places: [{ id: 'place-1', version: 2, name: '想去的地方', lat: null, lng: null, year: 2026, storyIds: ['story-1'], wishIds: ['wish-1'] }],
  wishPlans: [{ id: 'wish-1', version: 3, plannedDate: null, storyId: 'story-1' }],
});
const wishes = () => [{ id: 'wish-1', text: '一起散步', done: false }];

test('visible export preserves text, dates, states, nulls and record links in its versioned format', () => {
  assert.deepEqual(buildMemoryExport(fixture(), wishes(), exportedAt), {
    format: 'loveuhqq-visible-records', version: 1, exportedAt,
    member: { id: 'one', name: '男生' },
    members: [{ id: 'one', name: '男生' }, { id: 'two', name: '女生' }],
    stories: [{
      id: 'story-1', title: '一起记下', date: '2026-10-19', text: '第一行\n第二行，中文。',
      wishIds: ['wish-1'], layout: 'journal', revealTogether: true, openedAt: null,
      parts: [{ memberId: 'one', submitted: false, text: '自己的版本\n继续写', reply: '' }, { memberId: 'two', submitted: true }],
    }],
    letters: [{ id: 'letter-1', senderId: 'one', recipientId: 'two', title: '未来的一页', openDate: '2026-10-19', pairKey: 'pair-1', status: 'sealed', sealedAt: 1234, readable: true, text: '信的第一行\n信的第二行' }],
    places: [{ id: 'place-1', name: '想去的地方', lat: null, lng: null, year: 2026, storyIds: ['story-1'], wishIds: ['wish-1'] }],
    wishes: [{ id: 'wish-1', text: '一起散步', done: false }],
    wishPlans: [{ id: 'wish-1', plannedDate: null, storyId: 'story-1' }],
  });
});

test('export never mutates or shares nested input records and arrays', () => {
  const fresh = fixture(); const savedWishes = wishes();
  const before = structuredClone({ fresh, savedWishes });
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(fresh); freeze(savedWishes);
  const result = buildMemoryExport(fresh, savedWishes, exportedAt);
  result.member.name = 'changed'; result.members[0].name = 'changed';
  result.stories[0].wishIds.push('another'); result.stories[0].parts[0].text = 'changed';
  result.letters[0].text = 'changed'; result.places[0].storyIds.push('another');
  result.places[0].wishIds.push('another'); result.wishes[0].done = true; result.wishPlans[0].storyId = null;
  assert.deepEqual({ fresh, savedWishes }, before);
});

test('unrevealed other parts and unreadable letters omit bodies even if unexpected bodies are present', () => {
  const fresh = fixture();
  fresh.stories[0].parts[1].text = 'HIDDEN_OTHER_TEXT';
  fresh.stories[0].parts[1].reply = 'HIDDEN_OTHER_REPLY';
  fresh.letters[0].readable = false;
  fresh.letters[0].text = 'HIDDEN_FUTURE_LETTER';
  const result = buildMemoryExport(fresh, wishes(), exportedAt);
  assert.deepEqual(result.stories[0].parts[1], { memberId: 'two', submitted: true });
  assert.equal('text' in result.letters[0], false);
  assert.equal(result.letters[0].pairKey, 'pair-1');
  assert.doesNotMatch(JSON.stringify(result), /HIDDEN_/);
  fresh.stories[0].openedAt = 1234;
  assert.equal(buildMemoryExport(fresh, [], exportedAt).stories[0].parts[1].text, 'HIDDEN_OTHER_TEXT');
  fresh.stories[0].openedAt = null; fresh.stories[0].revealTogether = false;
  assert.equal(buildMemoryExport(fresh, [], exportedAt).stories[0].parts[1].reply, 'HIDDEN_OTHER_REPLY');
});

test('missing optional readable text stays absent and empty saved collections export normally', () => {
  const fresh = fixture(); delete fresh.stories[0].parts[0].text; delete fresh.letters[0].text;
  const result = buildMemoryExport(fresh, [], exportedAt);
  assert.equal('text' in result.stories[0].parts[0], false);
  assert.equal('text' in result.letters[0], false);
  assert.deepEqual(buildMemoryExport({ ...fresh, stories: [], letters: [], places: [], wishPlans: [] }, [], exportedAt), {
    format: 'loveuhqq-visible-records', version: 1, exportedAt,
    member: fresh.member, members: fresh.members, stories: [], letters: [], places: [], wishes: [], wishPlans: [],
  });
});

test('whitelists every level and excludes notebook notes, revision numbers, credentials and media metadata', () => {
  const fresh = fixture(); const savedWishes = wishes();
  const poison = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(poison); return; }
    Object.values(value).forEach(poison);
    Object.assign(value, { token: 'SENTINEL_TOKEN', session: 'SENTINEL_SESSION', cookie: 'SENTINEL_COOKIE', notes: 'SENTINEL_NOTE', revisions: 'SENTINEL_REVISION', mediaURL: 'SENTINEL_MEDIA', photoUrl: 'SENTINEL_PHOTO' });
  };
  poison(fresh); poison(savedWishes);
  const json = JSON.stringify(buildMemoryExport(fresh, savedWishes, exportedAt));
  assert.doesNotMatch(json, /SENTINEL_|private-photo|private-audio|photoIds|audioIds|"notes"|"revisions"/);
  const result = JSON.parse(json);
  assert.equal('version' in result.stories[0], false);
  assert.equal('version' in result.stories[0].parts[0], false);
  assert.equal('version' in result.letters[0], false);
  assert.equal('version' in result.places[0], false);
  assert.equal('version' in result.wishPlans[0], false);
});

test('unselected signature fails rather than creating an empty export', () => {
  assert.throws(() => buildMemoryExport({ ...fixture(), member: null }, wishes(), exportedAt), /署名/);
});
