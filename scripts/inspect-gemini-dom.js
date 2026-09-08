// Dán đoạn này vào Console (F12) trên tab gemini.google.com/app đã đăng nhập, Enter,
// rồi copy toàn bộ output JSON gửi lại — dùng để vá đúng selector thật vào src/content/selectors.ts.
(function () {
  const short = (el) => ({
    tag: el.tagName,
    id: el.id || undefined,
    class: (el.className && String(el.className).slice(0, 120)) || undefined,
    ariaLabel: el.getAttribute('aria-label') || undefined,
    dataTestId: el.getAttribute('data-test-id') || el.getAttribute('data-testid') || undefined,
    role: el.getAttribute('role') || undefined,
    placeholder: el.getAttribute('placeholder') || undefined,
    text: (el.textContent || '').trim().slice(0, 60) || undefined
  });

  const report = {
    url: location.href,
    contentEditableCandidates: Array.from(document.querySelectorAll('[contenteditable="true"]')).map(short),
    textareaCandidates: Array.from(document.querySelectorAll('textarea')).map(short),
    sendButtonCandidates: Array.from(document.querySelectorAll('button'))
      .filter((b) => /send|gửi|submit/i.test(b.getAttribute('aria-label') || '') || /send|gửi/i.test(b.textContent || ''))
      .map(short),
    modelSwitcherCandidates: Array.from(document.querySelectorAll('button, div[role="button"]'))
      .filter((b) => /model|mô hình|gemini|flash|pro/i.test(b.getAttribute('aria-label') || '') || /model|mô hình/i.test(b.textContent || ''))
      .slice(0, 15)
      .map(short),
    imageResultCandidates: Array.from(document.querySelectorAll('img')).slice(-10).map(short),
    videoResultCandidates: Array.from(document.querySelectorAll('video')).map(short)
  };

  const json = JSON.stringify(report, null, 2);
  console.log(json);
  try {
    copy(json); // Chrome DevTools helper — tự copy vào clipboard nếu chạy được
    console.log('%c-> Đã copy JSON vào clipboard, paste gửi lại luôn.', 'color:green;font-weight:bold');
  } catch {
    console.log('-> Copy thủ công đoạn JSON phía trên gửi lại giúp mình.');
  }
})();
