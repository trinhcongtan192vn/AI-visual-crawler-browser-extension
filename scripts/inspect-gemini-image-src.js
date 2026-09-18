// Dán vào Console trên gemini.google.com/app NGAY SAU KHI có ảnh Gemini vừa tạo ra.
(function () {
  const imgs = Array.from(document.querySelectorAll('generated-image img, img[alt*="Generated" i]'));
  const result = imgs.map((img) => ({
    src: img.src,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    alt: img.getAttribute('alt')
  }));
  const json = JSON.stringify(result, null, 2);
  console.log(json);
  try {
    copy(json);
    console.log('%c-> Đã copy JSON vào clipboard.', 'color:green;font-weight:bold');
  } catch {
    console.log('-> Copy thủ công đoạn JSON phía trên.');
  }
})();
