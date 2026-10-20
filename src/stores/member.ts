import { createStore } from 'zustand/vanilla';

export type MemberId = 'one' | 'two' | null;
export interface MemberStoreState { memberId: MemberId }

export const memberStore = createStore<MemberStoreState>()(() => ({ memberId: null }));
