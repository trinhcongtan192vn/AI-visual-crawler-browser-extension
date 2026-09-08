// Dán vào Console trên chatgpt.com SAU KHI đã có ít nhất 1 ảnh được ChatGPT tạo ra trong
// cuộc hội thoại hiện tại — dùng để vá đúng resultImage/turnContainer/generatingMarker.
(function () {
  const short = (el) => ({
    tag: el.tagName,
    id: el.id || undefined,
    class: (el.className && String(el.className).slice(0, 150)) || undefined,
    role: el.getAttribute('role') || undefined,
    dataTestId: el.getAttribute('data-testid') || undefined,
    dataMessageAuthorRole: el.getAttribute('data-message-author-role') || undefined,
    src: el.tagName === 'IMG' ? (el.getAttribute('src') || '').slice(0, 80) : undefined,
    alt: el.getAttribute('alt') || undefined
  });

  const describeAncestors = (el, depth = 6) => {
    const chain = [];
    let cur = el;
    for (let i = 0; i < depth && cur; i++) {
      chain.push(short(cur));
      cur = cur.parentElement;
    }
    return chain;
  };

  const allImgs = Array.from(document.querySelectorAll('main img'));
  const lastFewImgs = allImgs.slice(-3).map((img) => ({
    img: short(img),
    ancestorChain: describeAncestors(img.parentElement, 6)
  }));

  const turnCandidates = Array.from(
    document.querySelectorAll('main [data-testid], main [role="presentation"], main article')
  )
    .slice(-10)
    .map(short);

  const stopOrSpinnerCandidates = Array.from(document.querySelectorAll('button, [role="status"], svg'))
    .filter((el) => /stop|dừng|generating|spinner|loading/i.test(el.getAttribute('aria-label') || '') || /animate-spin/i.test(el.className || ''))
    .slice(0, 10)
    .map(short);

  const downloadButtonCandidates = Array.from(document.querySelectorAll('button, a'))
    .filter((el) => /download|tải/i.test(el.getAttribute('aria-label') || ''))
    .map((el) => ({ ...short(el), href: el.getAttribute('href') || undefined }));

  const json = JSON.stringify(
    {
      url: location.href,
      lastFewImgs,
      turnCandidates,
      stopOrSpinnerCandidates,
      downloadButtonCandidates
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
