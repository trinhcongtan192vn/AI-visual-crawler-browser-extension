// Regression test cho đúng bất biến làm vỡ side panel (xem App.test.tsx):
// useSyncExternalStore yêu cầu getSnapshot trả về CÙNG reference khi state chưa đổi.
import { describe, expect, it } from 'vitest';
import { getState, updateConfig } from '../store';

describe('panel store snapshot stability', () => {
  it('getState() returns the exact same reference across calls when nothing changed', () => {
    const a = getState();
    const b = getState();
    expect(a).toBe(b);
  });

  it('getState() returns a NEW reference only after an actual state-changing action', () => {
    const before = getState();
    updateConfig({ outputFolder: 'changed-for-test' });
    const after = getState();
    expect(after).not.toBe(before);
    expect(after.config.outputFolder).toBe('changed-for-test');
    // Gọi lại lần nữa mà không đổi gì thì phải ổn định trở lại.
    expect(getState()).toBe(after);
  });
});
