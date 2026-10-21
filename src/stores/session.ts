import { createStore } from 'zustand/vanilla';
import type { SessionState } from '../lib/cloud-notebook';

export interface SessionStoreState extends SessionState {
  logoutUnconfirmed: boolean;
}

export const sessionStore = createStore<SessionStoreState>()(() => ({
  authenticated: false,
  configured: false,
  logoutUnconfirmed: false,
}));
