// Regression test cho bug: bấm "Bắt đầu", trạng thái "đang chạy" nhưng Gemini không nhận
// prompt/không gửi. Xác nhận thực tế trên gemini.google.com: nút "Send message" có
// disabled=true khi ô prompt rỗng, chỉ disabled=false một lúc SAU KHI Angular xử lý input —
// code cũ chỉ `sleep(150)` cố định rồi lấy nút bất kể còn disabled hay không.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForEnabledButton } from '../dom-utils';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('waitForEnabledButton', () => {
  it('does not return a button that is still disabled', async () => {
    document.body.innerHTML = '<button aria-label="Send message" disabled>Send</button>';
    const controller = new AbortController();
    const result = await waitForEnabledButton(['button[aria-label="Send message"]'], {
      timeoutMs: 300,
      signal: controller.signal,
      pollMs: 50
    });
    expect(result).toBeNull();
  });

  it('waits for the button to become enabled (simulates Angular enabling it a moment after input)', async () => {
    document.body.innerHTML = '<button aria-label="Send message" disabled>Send</button>';
    const btn = document.querySelector('button')!;

    setTimeout(() => btn.removeAttribute('disabled'), 100);

    const controller = new AbortController();
    const result = await waitForEnabledButton(['button[aria-label="Send message"]'], {
      timeoutMs: 2_000,
      signal: controller.signal,
      pollMs: 30
    });
    expect(result).toBe(btn);
  });

  it('returns null (not throw) when nothing matches within the timeout, so callers can fall back safely', async () => {
    document.body.innerHTML = '<div>no button here</div>';
    const controller = new AbortController();
    const result = await waitForEnabledButton(['button[aria-label="Send message"]'], {
      timeoutMs: 100,
      signal: controller.signal,
      pollMs: 30
    });
    expect(result).toBeNull();
  });
});
