import { api, type SessionState } from './cloud-notebook';

let pending: Promise<SessionState> | undefined;
let current: SessionState = { authenticated: false, configured: false };
let generation = 0;
let initialized = false;
export function onSessionChange(listener: (state: SessionState) => void): void {
  document.addEventListener('session:changed', event => listener((event as CustomEvent<SessionState>).detail));
  if (initialized) listener(current);
}
export function publishSession(state: SessionState) {
  generation++;
  current = state;
  initialized = true;
  pending = Promise.resolve(state);
  document.dispatchEvent(new CustomEvent<SessionState>('session:changed', { detail: state }));
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
