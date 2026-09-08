// Regression cho nghi vấn: ChatGPT dùng ProseMirror, có thể âm thầm bỏ qua
// document.execCommand('insertText', ...) — setPromptText phải có đường lùi (paste event)
// thay vì im lặng để prompt trống. jsdom không cài execCommand thật nên tự nhiên mô phỏng
// đúng kịch bản "editor không nhận execCommand".
import { afterEach, describe, expect, it } from 'vitest';
import { setPromptText } from '../dom-utils';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('setPromptText on contenteditable (no native execCommand support, like jsdom/ProseMirror-reject case)', () => {
  it('falls back to a paste event that a real rich editor could handle', () => {
    document.body.innerHTML = '<div contenteditable="true" id="editor"></div>';
    const el = document.getElementById('editor')!;

    // Mô phỏng một editor kiểu ProseMirror: chỉ chấp nhận text qua paste event, tự chèn
    // vào DOM theo cách riêng của nó (không phải qua execCommand).
    el.addEventListener('paste', (e) => {
      const text = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
      const p = document.createElement('p');
      p.textContent = text;
      el.appendChild(p);
    });

    setPromptText(el, 'Xin chào từ AI Visual Generator');

    expect(el.textContent).toContain('Xin chào từ AI Visual Generator');
    // Phải thực sự đi qua listener 'paste' (tạo ra <p>), không phải chỉ trùng hợp khớp nhờ
    // đường lùi cuối (ghi thẳng textContent, không tạo <p>) — phân biệt rõ 2 đường lùi.
    expect(el.querySelector('p')).not.toBeNull();
  });

  it('falls back all the way to direct textContent write when nothing handles paste either', () => {
    document.body.innerHTML = '<div contenteditable="true" id="editor"></div>';
    const el = document.getElementById('editor')!;

    setPromptText(el, 'Prompt không ai xử lý paste');

    expect(el.textContent).toContain('Prompt không ai xử lý paste');
    expect(el.querySelector('p')).toBeNull(); // xác nhận đi qua đường ghi thẳng, không phải paste
  });

  it('plain textarea still uses the fast native-value path (no paste fallback needed)', () => {
    document.body.innerHTML = '<textarea id="ta"></textarea>';
    const el = document.getElementById('ta') as HTMLTextAreaElement;

    setPromptText(el, 'Textarea prompt');

    expect(el.value).toBe('Textarea prompt');
  });
});
