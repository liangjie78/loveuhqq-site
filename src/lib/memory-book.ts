/** Private memory-book API contracts. All IDs and authors are checked by the Worker. */
export type MemberId = 'one' | 'two';
export interface MemoryMember { id: MemberId; name: string }
export type StoryLayout = 'journal' | 'album' | 'letter';
export interface StoryPart { memberId: MemberId; version: number; submitted: boolean; text?: string; reply?: string; audioIds?: string[] }
export interface MemoryStory {
  id: string; version: number; title: string; date: string; text: string; photoIds: string[]; wishIds: string[];
  layout: StoryLayout; revealTogether: boolean; openedAt: number | null; parts: StoryPart[];
}
export interface MemoryLetter {
  id: string; version: number; senderId: MemberId; recipientId: MemberId; title: string; openDate: string;
  pairKey: string; status: 'draft' | 'sealed'; sealedAt: number | null; readable: boolean; text?: string; audioIds?: string[];
}
export interface MemoryPlace { id: string; version: number; name: string; lat: number; lng: number; year: number; storyIds: string[]; wishIds: string[] }
export interface WishPlan { id: string; version: number; plannedDate: string | null; storyId: string | null }
export interface MemoryAudio { id: string; mime: string; bytes: number; duration: number }
export interface MemoryBootstrap { member: MemoryMember | null; members: MemoryMember[]; stories: MemoryStory[]; letters: MemoryLetter[]; places: MemoryPlace[]; wishPlans: WishPlan[] }
export interface StoryInput { expectedVersion: number; title: string; date: string; text: string; photoIds: string[]; wishIds: string[]; layout: StoryLayout; revealTogether: boolean }
export interface PartInput { expectedVersion: number; text: string; reply: string; submitted: boolean; audioIds: string[] }
export interface LetterInput { expectedVersion: number; title: string; text: string; recipientId: MemberId; openDate: string; pairKey: string; audioIds: string[] }
export interface PlaceInput { expectedVersion: number; name: string; lat: number; lng: number; year: number; storyIds: string[]; wishIds: string[] }
export interface WishPlanInput { expectedVersion: number; plannedDate: string | null; storyId: string | null }
export const memoryApiRoot = '/api/memory';
export const audioMaxBytes = 4 * 1024 * 1024;
export const audioMaxSeconds = 60;
/** Audio POST uses binary body, Content-Type and X-Audio-Duration seconds, ?storyId= or ?letterId=. */
export const memoryAudioUrl = (id: string) => `${memoryApiRoot}/audio/${encodeURIComponent(id)}`;
