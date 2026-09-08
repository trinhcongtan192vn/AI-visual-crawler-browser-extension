// Regression test cho bug: "Chưa đăng nhập gemini" báo sai dù user đã đăng nhập thật.
// Nguyên nhân: isLoggedIn() cũ bắt buộc phải tìm thấy `promptInput` — một selector CHƯA
// được xác minh trên trang thật (06.7) — nên false negative do selector sai làm dừng oan
// cả batch. Nay chỉ dựa vào loggedOutMarker (dấu hiệu đăng xuất rõ ràng).
import { afterEach, describe, expect, it } from 'vitest';
import { ChatGptAdapter } from '../adapter-chatgpt';
import { GeminiAdapter } from '../adapter-gemini';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isLoggedIn does not false-negative when promptInput selector fails to match', () => {
  it('gemini: reports logged in even if none of the guessed promptInput selectors match anything in the DOM', () => {
    document.body.innerHTML = '<div>Trang Gemini thật với DOM khác hoàn toàn selector đoán</div>';
    const adapter = new GeminiAdapter();
    expect(adapter.isLoggedIn()).toBe(true);
  });

  it('chatgpt: reports logged in even if none of the guessed promptInput selectors match anything in the DOM', () => {
    document.body.innerHTML = '<div>Trang ChatGPT thật với DOM khác hoàn toàn selector đoán</div>';
    const adapter = new ChatGptAdapter();
    expect(adapter.isLoggedIn()).toBe(true);
  });

  it('gemini: still reports logged out when an explicit loggedOutMarker is present', () => {
    document.body.innerHTML = '<a href="https://accounts.google.com/signin">Sign in</a>';
    const adapter = new GeminiAdapter();
    expect(adapter.isLoggedIn()).toBe(false);
  });

  it('chatgpt: still reports logged out when an explicit loggedOutMarker is present', () => {
    document.body.innerHTML = '<div>Please Log in to continue</div>';
    const adapter = new ChatGptAdapter();
    expect(adapter.isLoggedIn()).toBe(false);
  });
});
