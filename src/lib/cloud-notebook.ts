import type { CloudNotebook } from './notebook';
export type { CloudNotebook } from './notebook';
export interface SessionState { authenticated: boolean; configured: boolean }
export const emptyCloudNotebook = (): CloudNotebook => ({ version: 1, notes: {}, wishes: [], revisions: { notes: {}, wishes: {} } });

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options,
      signal: options.signal ?? controller.signal,
      headers: { 'Content-Type': 'application/json', ...options.headers } });
    const result = await response.json();
    if (!response.ok) throw new ApiError(response.status, result.error ?? '暂时无法连接手账，请稍后重试。');
    return result as T;
  } finally { clearTimeout(timeout); }
}
