// 05.9 — Persistence. Nguồn sự thật là chrome.storage.local (worker có thể bị suspend).
import { STORAGE_KEYS } from '../shared/constants';
import type { BatchState, RunConfig } from '../shared/types';
import { createLogger } from '../shared/logger';

const log = createLogger('persistence');

export async function persist(batch: BatchState): Promise<void> {
  batch.updatedAt = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEYS.BATCH_STATE]: batch });
}

export async function loadBatch(): Promise<BatchState | null> {
  const res = await chrome.storage.local.get(STORAGE_KEYS.BATCH_STATE);
  return (res[STORAGE_KEYS.BATCH_STATE] as BatchState | undefined) ?? null;
}

export async function clearBatch(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.BATCH_STATE);
}

export async function saveLastConfig(config: RunConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_CONFIG]: config });
}

export async function loadLastConfig(): Promise<RunConfig | null> {
  const res = await chrome.storage.local.get(STORAGE_KEYS.LAST_CONFIG);
  return (res[STORAGE_KEYS.LAST_CONFIG] as RunConfig | undefined) ?? null;
}

log.debug('persistence module loaded');
