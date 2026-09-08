// Dán vào Console trên gemini.google.com/app — tìm nút gửi bằng cách quét toàn bộ button
// nằm gần ô nhập prompt (thay vì lọc theo chữ "send/gửi" như script trước, vì nút có thể
// chỉ có icon không có text/aria-label rõ ràng).
(function () {
  const input = document.querySelector('.ql-editor[aria-label="Enter a prompt for Gemini"]');
  if (!input) {
    console.log('Không tìm thấy input — bấm vào ô prompt trước rồi chạy lại.');
    return;
  }

  const short = (el) => ({
    tag: el.tagName,
    class: (el.className && String(el.className).slice(0, 150)) || undefined,
    ariaLabel: el.getAttribute('aria-label') || undefined,
    dataTestId: el.getAttribute('data-test-id') || el.getAttribute('data-testid') || undefined,
    matIcon: el.querySelector('mat-icon')?.getAttribute('fonticon') || el.querySelector('mat-icon')?.textContent?.trim() || undefined,
    disabled: el.disabled ?? el.getAttribute('aria-disabled') ?? undefined,
    outerHtmlSnippet: el.outerHTML.slice(0, 200)
  });

  // Đi lên vài cấp cha từ ô input để tìm container chứa cả input lẫn nút gửi.
  let container = input;
  for (let i = 0; i < 6 && container.parentElement; i++) container = container.parentElement;

  const buttons = Array.from(container.querySelectorAll('button')).map(short);
  const json = JSON.stringify({ url: location.href, buttonsNearInput: buttons }, null, 2);
  console.log(json);
  try {
    copy(json);
    console.log('%c-> Đã copy JSON vào clipboard.', 'color:green;font-weight:bold');
  } catch {
    console.log('-> Copy thủ công đoạn JSON phía trên.');
  }
})();
