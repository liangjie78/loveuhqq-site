import type { MemoryBootstrap, MemoryLetter, MemoryMember, MemoryPlace, MemoryStory, StoryPart, WishPlan } from './memory-book';
import type { Wish } from './notebook';

export interface MemoryExportV1 {
  format: 'loveuhqq-visible-records';
  version: 1;
  exportedAt: string;
  member: MemoryMember;
  members: MemoryMember[];
  stories: (Pick<MemoryStory, 'id' | 'title' | 'date' | 'text' | 'wishIds' | 'layout' | 'revealTogether' | 'openedAt'> & {
    parts: Pick<StoryPart, 'memberId' | 'submitted' | 'text' | 'reply'>[];
  })[];
  letters: Pick<MemoryLetter, 'id' | 'senderId' | 'recipientId' | 'title' | 'openDate' | 'pairKey' | 'status' | 'sealedAt' | 'readable' | 'text'>[];
  places: Pick<MemoryPlace, 'id' | 'name' | 'lat' | 'lng' | 'year' | 'storyIds' | 'wishIds'>[];
  wishes: Wish[];
  wishPlans: Pick<WishPlan, 'id' | 'plannedDate' | 'storyId'>[];
}

export function buildMemoryExport(fresh: MemoryBootstrap, wishes: readonly Wish[], exportedAt: string): MemoryExportV1 {
  const member = fresh.member;
  if (!member) throw new Error('请选择署名后再导出。');
  return {
    format: 'loveuhqq-visible-records', version: 1, exportedAt,
    member: { id: member.id, name: member.name },
    members: fresh.members.map(item => ({ id: item.id, name: item.name })),
    stories: fresh.stories.map(story => ({
      id: story.id, title: story.title, date: story.date, text: story.text,
      wishIds: [...story.wishIds], layout: story.layout, revealTogether: story.revealTogether, openedAt: story.openedAt,
      parts: story.parts.map(part => {
        const readable = part.memberId === member.id || !story.revealTogether || story.openedAt !== null;
        return {
          memberId: part.memberId, submitted: part.submitted,
          ...(readable && part.text !== undefined ? { text: part.text } : {}),
          ...(readable && part.reply !== undefined ? { reply: part.reply } : {}),
        };
      }),
    })),
    letters: fresh.letters.map(letter => ({
      id: letter.id, senderId: letter.senderId, recipientId: letter.recipientId,
      title: letter.title, openDate: letter.openDate, pairKey: letter.pairKey,
      status: letter.status, sealedAt: letter.sealedAt, readable: letter.readable,
      ...(letter.readable && letter.text !== undefined ? { text: letter.text } : {}),
    })),
    places: fresh.places.map(place => ({
      id: place.id, name: place.name, lat: place.lat, lng: place.lng, year: place.year,
      storyIds: [...place.storyIds], wishIds: [...place.wishIds],
    })),
    wishes: wishes.map(wish => ({ id: wish.id, text: wish.text, done: wish.done })),
    wishPlans: fresh.wishPlans.map(plan => ({ id: plan.id, plannedDate: plan.plannedDate, storyId: plan.storyId })),
  };
}
