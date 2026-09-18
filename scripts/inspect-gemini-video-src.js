// Dán vào Console trên gemini.google.com/app NGAY SAU KHI video Gemini tạo xong.
// Hover chuột lên video đó TRƯỚC KHI chạy (để nút "Download video" hiện ra, nếu cần soi luôn).
(function () {
  const short = (el) => ({
    tag: el.tagName,
    class: (el.className && String(el.className).slice(0, 150)) || undefined,
    ariaLabel: el.getAttribute('aria-label') || undefined,
    href: el.getAttribute('href') || undefined
  });

  const videos = Array.from(document.querySelectorAll('video'));
  const videoInfo = videos.map((v) => ({
    src: v.src || undefined,
    currentSrc: v.currentSrc || undefined,
    duration: v.duration,
    videoWidth: v.videoWidth,
    videoHeight: v.videoHeight
  }));

  // Tìm nút tải video (aria-label chứa "download"/"tải" + "video") ở bất kỳ đâu trên trang.
  const downloadButtons = Array.from(document.querySelectorAll('button, a'))
    .filter((el) => {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      return (label.includes('download') || label.includes('tải')) && label.includes('video');
    })
    .map(short);

  const json = JSON.stringify({ url: location.href, videoInfo, downloadButtons }, null, 2);
  console.log(json);
  try {
    copy(json);
    console.log('%c-> Đã copy JSON vào clipboard.', 'color:green;font-weight:bold');
  } catch {
    console.log('-> Copy thủ công đoạn JSON phía trên.');
  }
})();
