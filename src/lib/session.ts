import { api, type SessionState } from './cloud-notebook';
import { sessionStore } from '../stores/session';

let pending: Promise<SessionState> | undefined;
let current: SessionState = { authenticated: false, configured: false };
let generation = 0;
let initialized = false;
export function onSessionChange(listener: (state: SessionState) => void): void {
  sessionStore.subscribe(state => listener({ authenticated: state.authenticated, configured: state.configured }));
  if (initialized) listener(current);
}
export function publishSession(state: SessionState, logoutUnconfirmed = sessionStore.getState().logoutUnconfirmed) {
  generation++;
  current = state;
  initialized = true;
  pending = Promise.resolve(state);
  sessionStore.setState({ ...state, logoutUnconfirmed });
}
export function getSession(): Promise<SessionState> {
  return pending ??= readSession();
}
export async function refreshSession(): Promise<SessionState> {
  return readSession();
}
async function readSession(): Promise<SessionState> {
  const requestGeneration = ++generation;
  try {
    const state = await api<SessionState>('/api/session');
    if (requestGeneration !== generation) return current;
    publishSession(state);
    return state;
  } catch (error) {
    if (requestGeneration !== generation) return current;
    pending = undefined;
    throw error;
  }
}
