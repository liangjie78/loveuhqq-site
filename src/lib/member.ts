import { api } from './cloud-notebook';
import type { MemoryBootstrap } from './memory-book';
import { memberStore, type MemberId } from '../stores/member';
import { sessionStore } from '../stores/session';

let requestGeneration = 0;
let lastAuthenticated = sessionStore.getState().authenticated;

sessionStore.subscribe(state => {
  if (state.authenticated === lastAuthenticated) return;
  lastAuthenticated = state.authenticated;
  if (!state.authenticated) {
    requestGeneration += 1;
    memberStore.setState({ memberId: null });
  }
});

export function beginMemberRequest(): number {
  requestGeneration += 1;
  return requestGeneration;
}

export function isLatestMemberRequest(generation: number): boolean {
  return generation === requestGeneration;
}

export function setCurrentMember(memberId: MemberId, generation?: number): boolean {
  if (memberId !== null && !sessionStore.getState().authenticated) return false;
  if (generation === undefined) requestGeneration += 1;
  else if (!isLatestMemberRequest(generation)) return false;
  memberStore.setState({ memberId });
  return true;
}

export async function selectMember(id: Exclude<MemberId, null>, signal?: AbortSignal, requestId?: number): Promise<MemoryBootstrap | null> {
  const generation = requestId ?? beginMemberRequest();
  if (!isLatestMemberRequest(generation) || signal?.aborted || !sessionStore.getState().authenticated) return null;
  const book = await api<MemoryBootstrap>('/api/memory/identity', {
    method: 'POST',
    signal,
    body: JSON.stringify({ id }),
  });
  if (signal?.aborted || !sessionStore.getState().authenticated || !setCurrentMember(book.member?.id ?? null, generation)) return null;
  return book;
}
