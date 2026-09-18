// Dán vào Console trên gemini.google.com/app SAU KHI đã có ít nhất 1 ảnh được Gemini tạo ra.
// Hover chuột lên ảnh đó (nhiều UI chỉ hiện nút tải khi hover) TRƯỚC KHI chạy script này.
(function () {
  const short = (el) => ({
    tag: el.tagName,
    id: el.id || undefined,
    class: (el.className && String(el.className).slice(0, 150)) || undefined,
    ariaLabel: el.getAttribute('aria-label') || undefined,
    dataTestId: el.getAttribute('data-test-id') || el.getAttribute('data-testid') || undefined,
    href: el.getAttribute('href') || undefined,
    matIcon: el.querySelector && (el.querySelector('mat-icon')?.getAttribute('fonticon') || el.querySelector('mat-icon')?.textContent?.trim()) || undefined
  });

  // Ảnh Gemini tạo ra thường nằm trong thẻ tùy chỉnh, không phải <img> đơn giản luôn —
  // quét cả <img> lẫn các phần tử có class gợi ý "image".
  const candidateImgs = Array.from(document.querySelectorAll('img')).filter((img) => {
    const src = img.src || '';
    return src.includes('googleusercontent') || src.includes('lh3') || img.closest('generated-image') || img.naturalWidth > 200;
  });
  const lastImg = candidateImgs[candidateImgs.length - 1] || document.querySelectorAll('img')[document.querySelectorAll('img').length - 1];

  let container = lastImg;
  const chain = [];
  for (let i = 0; i < 8 && container; i++) {
    chain.push(short(container));
    container = container.parentElement;
  }

  // Đi lên 5 cấp từ ảnh để tìm mọi nút/link trong vùng lân cận (nơi thường chứa nút tải khi hover).
  let scopeRoot = lastImg;
  for (let i = 0; i < 5 && scopeRoot?.parentElement; i++) scopeRoot = scopeRoot.parentElement;
  const nearbyButtons = scopeRoot
    ? Array.from(scopeRoot.querySelectorAll('button, a')).map(short)
    : [];

  const json = JSON.stringify(
    {
      url: location.href,
      lastImgSrc: (lastImg?.src || '').slice(0, 100),
      ancestorChain: chain,
      nearbyButtonsAndLinks: nearbyButtons
    },
    null,
    2
  );
  console.log(json);
  try {
    copy(json);
    console.log('%c-> Đã copy JSON vào clipboard.', 'color:green;font-weight:bold');
  } catch {
    console.log('-> Copy thủ công đoạn JSON phía trên.');
  }
})();
