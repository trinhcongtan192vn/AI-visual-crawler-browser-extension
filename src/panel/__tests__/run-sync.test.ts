// Regression test cho bug: bấm "Bắt đầu" ở Config nhưng Run screen không hiện gì.
// Nguyên nhân: startBatch() không lưu batch cục bộ, và handler JOB_UPDATE/BATCH_UPDATE có
// `if (!state.batch) return;` nên âm thầm vứt update đầu tiên (và mọi update sau đó, vì
// worker không tự gửi lại STATE_SNAPSHOT sau START_BATCH — nó chỉ đẩy JOB_UPDATE/BATCH_UPDATE).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../../shared/types';

vi.mock('../port', () => {
  const listeners: Array<(msg: any) => void> = [];
  return {
    send: vi.fn(),
    ensureConnected: vi.fn(),
    onMessage: vi.fn((fn: (msg: any) => void) => {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }),
    __emit: (msg: any) => listeners.slice().forEach((fn) => fn(msg))
  };
});

import * as port from '../port';
import { getState, initPort, startBatch } from '../store';

const emit = (msg: unknown) => (port as any).__emit(msg);
const sendMock = () => port.send as unknown as ReturnType<typeof vi.fn>;
const getStateCallCount = () => sendMock().mock.calls.filter(([m]: any) => m?.type === 'GET_STATE').length;

function fakeJob(overrides: Partial<Job> = {}): Job {
  return {
    blockId: 'B01',
    kind: 'image',
    originalKind: 'image',
    downgraded: false,
    prompt: 'p',
    status: 'running',
    attempts: 0,
    ...overrides
  };
}

describe('panel run sync after clicking Start', () => {
  beforeEach(() => {
    initPort();
    vi.clearAllMocks(); // bỏ qua GET_STATE gọi lúc mount panel, chỉ quan tâm hành vi sau đó
  });

  it('startBatch() proactively re-requests full state instead of relying only on later push updates', () => {
    startBatch();
    expect(sendMock()).toHaveBeenCalledWith(expect.objectContaining({ type: 'START_BATCH' }));
    expect(getStateCallCount()).toBeGreaterThanOrEqual(1);
  });

  it('self-heals (re-requests state) instead of permanently dropping a JOB_UPDATE when local batch is still unknown', () => {
    expect(getState().batch).toBeNull();
    emit({ type: 'JOB_UPDATE', job: fakeJob() });
    expect(getStateCallCount()).toBeGreaterThanOrEqual(1);
  });

  it('self-heals on BATCH_UPDATE too', () => {
    expect(getState().batch).toBeNull();
    emit({ type: 'BATCH_UPDATE', status: 'running', counters: { total: 1, done: 0, failed: 0, skipped: 0 } });
    expect(getStateCallCount()).toBeGreaterThanOrEqual(1);
  });

  it('end-to-end: once STATE_SNAPSHOT arrives, subsequent JOB_UPDATE messages actually apply', () => {
    startBatch();
    const batch = {
      batchId: 'batch-1',
      status: 'running' as const,
      config: getState().config,
      jobs: [fakeJob()],
      currentIndex: 0,
      counters: { total: 1, done: 0, failed: 0, skipped: 0 },
      createdAt: 0,
      updatedAt: 0,
      manifestRecords: []
    };
    emit({ type: 'STATE_SNAPSHOT', batch });
    expect(getState().batch?.batchId).toBe('batch-1');
    expect(getState().step).toBe('run');

    emit({ type: 'JOB_UPDATE', job: fakeJob({ status: 'done', outputFileName: 'B01.png' }) });
    expect(getState().batch?.jobs[0].status).toBe('done');
    expect(getState().batch?.jobs[0].outputFileName).toBe('B01.png');
  });
});
