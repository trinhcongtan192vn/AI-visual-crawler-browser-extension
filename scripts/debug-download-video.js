// Dán vào Console của SERVICE WORKER (chrome://extensions -> link "service worker").
// Thay PASTE_URL_HERE bằng currentSrc thật lấy từ document.querySelector('video').currentSrc
// trên tab Gemini. Script này gọi thẳng chrome.downloads.download() y hệt cách extension làm,
// nhưng log ra MỌI thay đổi trạng thái + lý do lỗi cụ thể (nếu có) để biết chính xác Chrome
// chặn ở đâu, không qua logic retry/ẩn lỗi của extension.
(async function () {
  const url = 'PASTE_URL_HERE';
  if (url === 'PASTE_URL_HERE') {
    console.error('Chưa thay URL thật vào script.');
    return;
  }

  console.log('[debug] bắt đầu download.download() với url:', url);

  const listener = (delta) => {
    console.log('[debug] onChanged:', JSON.stringify(delta));
  };
  chrome.downloads.onChanged.addListener(listener);

  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: 'debug-test-video/test.mp4',
      conflictAction: 'uniquify',
      saveAs: false
    });
    console.log('[debug] downloadId =', downloadId);

    // Poll trạng thái đầy đủ (kể cả field "error") sau vài mốc thời gian.
    for (const delayMs of [1000, 3000, 8000, 15000]) {
      await new Promise((r) => setTimeout(r, delayMs));
      const [item] = await chrome.downloads.search({ id: downloadId });
      console.log(`[debug] +${delayMs}ms search():`, JSON.stringify(item, null, 2));
      if (item && (item.state === 'complete' || item.state === 'interrupted')) break;
    }
  } catch (err) {
    console.error('[debug] chrome.downloads.download() ném lỗi:', err);
  } finally {
    chrome.downloads.onChanged.removeListener(listener);
  }
})();
