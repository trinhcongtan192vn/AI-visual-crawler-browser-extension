// Store cục bộ của panel (không dùng localStorage). Cập nhật từ ProgressMsg + hành động UI.
import { useSyncExternalStore } from 'react';
import type { Block, BatchState, Job, RunConfig } from '../shared/types';
import type { ParseResult } from './excel/parser';
import { createJobFromBlock, buildPrompt } from './excel/prompt-builder';
import { DEFAULT_IMAGE_TEMPLATE, DEFAULT_VIDEO_TEMPLATE } from '../config/default-templates';
import { DEFAULT_INTER_BLOCK_DELAY } from '../shared/constants';
import * as port from './port';
import { createLogger } from '../shared/logger';

const log = createLogger('panel-store');

export type Step = 'import' | 'preview' | 'config' | 'run';

export interface PanelState {
  step: Step;
  fileName: string | null;
  blocks: Block[];
  fileWarnings: string[];
  stats: ParseResult['stats'] | null;
  parseError: string | null;
  config: RunConfig;
  jobs: Job[];
  batch: BatchState | null;
}

function defaultConfig(): RunConfig {
  return {
    provider: 'gemini',
    aspectRatio: '16:9',
    outputFolder: 'YT_Visuals',
    interBlockDelayMs: { ...DEFAULT_INTER_BLOCK_DELAY },
    promptTemplates: { image: DEFAULT_IMAGE_TEMPLATE, video: DEFAULT_VIDEO_TEMPLATE }
  };
}

let state: PanelState = {
  step: 'import',
  fileName: null,
  blocks: [],
  fileWarnings: [],
  stats: null,
  parseError: null,
  config: defaultConfig(),
  jobs: [],
  batch: null
};

const listeners = new Set<() => void>();

function setState(patch: Partial<PanelState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getState(): PanelState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore<T>(selector: (s: PanelState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

function rebuildJobs(blocks: Block[], config: RunConfig, prevJobs: Job[]): Job[] {
  const prevByBlockId = new Map(prevJobs.map((j) => [j.blockId, j]));
  return blocks.map((block) => {
    const prev = prevByBlockId.get(block.blockId);
    const job = createJobFromBlock(block, config);
    if (prev?.promptEditedByUser) {
      job.prompt = prev.prompt;
      job.promptEditedByUser = true;
    }
    return job;
  });
}

function suggestOutputFolder(fileName: string): string {
  const base = fileName.replace(/\.(xlsx|xls|csv)$/i, '').replace(/[\\/:*?"<>|]/g, '').trim();
  return `YT_Visuals_${base || 'project'}`;
}

export function loadParsedFile(fileName: string, result: { blocks: Block[]; fileWarnings: string[]; stats: ParseResult['stats'] }) {
  const config = state.config.outputFolder === 'YT_Visuals' || state.config.outputFolder === ''
    ? { ...state.config, outputFolder: suggestOutputFolder(fileName) }
    : state.config;
  const jobs = rebuildJobs(result.blocks, config, []);
  setState({
    fileName,
    blocks: result.blocks,
    fileWarnings: result.fileWarnings,
    stats: result.stats,
    parseError: null,
    config,
    jobs,
    step: 'import'
  });
}

export function setParseError(message: string | null) {
  setState({ parseError: message });
}

export function goToStep(step: Step) {
  setState({ step });
}

export function updateConfig(patch: Partial<RunConfig>) {
  const config = { ...state.config, ...patch };
  const jobs = rebuildJobs(state.blocks, config, state.jobs);
  setState({ config, jobs });
}

export function setJobPrompt(blockId: string, prompt: string) {
  const jobs = state.jobs.map((j) => (j.blockId === blockId ? { ...j, prompt, promptEditedByUser: true } : j));
  setState({ jobs });
}

export function toggleJobSkip(blockId: string) {
  const jobs = state.jobs.map((j) => {
    if (j.blockId !== blockId) return j;
    return { ...j, status: (j.status === 'skipped' ? 'pending' : 'skipped') as Job['status'] };
  });
  setState({ jobs });
}

/** "Áp dụng template lại" — ghi đè mọi chỉnh tay theo template hiện tại (08.3). */
export function reapplyTemplatesToAll() {
  const jobs = state.blocks.map((block) => createJobFromBlock(block, state.config));
  setState({ jobs });
}

export function startBatch() {
  const jobs = state.jobs;
  port.send({ type: 'START_BATCH', jobs, config: state.config });
  // Worker chỉ đẩy JOB_UPDATE/BATCH_UPDATE (cập nhật một phần) sau đó — chủ động xin
  // STATE_SNAPSHOT đầy đủ ngay để Run screen có batch để hiển thị mà không phải chờ.
  port.send({ type: 'GET_STATE' });
  setState({ step: 'run' });
}

export function pauseBatch() {
  port.send({ type: 'PAUSE_BATCH' });
}

export function resumeBatch() {
  port.send({ type: 'RESUME_BATCH' });
}

export function retryJob(blockId: string) {
  port.send({ type: 'RETRY_JOB', blockId });
}

export function retryAllFailed() {
  port.send({ type: 'RETRY_ALL_FAILED' });
}

export function cancelBatch() {
  port.send({ type: 'CANCEL_BATCH' });
}

export function exportManifest() {
  port.send({ type: 'EXPORT_MANIFEST' });
}

export function initPort() {
  port.onMessage((msg) => {
    switch (msg.type) {
      case 'STATE_SNAPSHOT':
        if (msg.batch) {
          setState({ batch: msg.batch, config: msg.batch.config, jobs: msg.batch.jobs, step: 'run' });
        }
        break;
      case 'JOB_UPDATE': {
        // Batch cục bộ chưa có (VD START_BATCH vừa gửi, STATE_SNAPSHOT chưa kịp về) — tự
        // yêu cầu đồng bộ lại thay vì âm thầm bỏ qua update này.
        if (!state.batch) {
          port.send({ type: 'GET_STATE' });
          return;
        }
        const jobs = state.batch.jobs.map((j) => (j.blockId === msg.job.blockId ? msg.job : j));
        setState({ batch: { ...state.batch, jobs } });
        break;
      }
      case 'BATCH_UPDATE':
        if (!state.batch) {
          port.send({ type: 'GET_STATE' });
          return;
        }
        setState({ batch: { ...state.batch, status: msg.status, counters: msg.counters } });
        break;
      case 'BATCH_DONE':
        log.info('batch done', msg.summary);
        break;
      case 'NEEDS_ATTENTION':
        if (!state.batch) return;
        setState({ batch: { ...state.batch, attentionReason: msg.reason } });
        break;
    }
  });
  port.ensureConnected();
  port.send({ type: 'GET_STATE' });
}

export { buildPrompt };
