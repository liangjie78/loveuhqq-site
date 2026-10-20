import { api } from './cloud-notebook';
import type { MemoryBootstrap } from './memory-book';
import { memberStore, type MemberId } from '../stores/member';

export function setCurrentMember(memberId: MemberId): void {
  memberStore.setState({ memberId });
}

export async function selectMember(id: Exclude<MemberId, null>, signal?: AbortSignal): Promise<MemoryBootstrap> {
  const book = await api<MemoryBootstrap>('/api/memory/identity', {
    method: 'POST',
    signal,
    body: JSON.stringify({ id }),
  });
  setCurrentMember(book.member?.id ?? null);
  return book;
}
