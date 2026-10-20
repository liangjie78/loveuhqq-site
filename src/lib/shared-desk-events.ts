import type { MemoryMember, MemoryStory } from './memory-book';
import type { PrivatePhoto } from './photos';

export interface SharedDeskData {
  member: MemoryMember;
  stories: MemoryStory[];
  photos: PrivatePhoto[];
}

export function emitSharedDeskUpdate(data: SharedDeskData | null): void {
  window.dispatchEvent(new CustomEvent('memory:shared-desk-update', { detail: data }));
}

export function requestSharedDeskUpdate(): void {
  window.dispatchEvent(new Event('memory:shared-desk-request'));
}
