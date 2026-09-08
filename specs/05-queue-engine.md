# 05 — Queue Engine (service worker)

File: `src/background/queue-engine.ts` (+ `tab-manager.ts`, `persistence.ts`).
Đây là bộ não điều phối. Không chạm DOM, không parse Excel.

## 5.1 Vòng đời batch

```
idle
 └─(START_BATCH)─> running ──(hết job)──> done
                    │  ▲
        (PAUSE) ────┘  └──── (RESUME)
                    │
      (phát hiện rate limit) ──> stopped_rate_limit ──(RESUME)──> running
                    │
      (chưa đăng nhập / lỗi nghiêm trọng) ──> needs_attention ──(RESUME)──> running
                    │
              (CANCEL) ──> cancelled
```

## 5.2 State machine cho từng Job

```
pending ──> running ──> done
                │
                ├─> failed        (lỗi có thể retry: TIMEOUT, SELECTOR_MISS, PROVIDER_ERROR)
                │      └─(RETRY_JOB / auto-retry)─> pending
                │
                └─> (RATE_LIMIT / NOT_LOGGED_IN)  => KHÔNG đánh job failed,
                       mà dừng cả batch (xem 5.5). Job quay lại pending để chạy khi resume.
```

Phân biệt quan trọng:
- Lỗi **cấp block** (timeout, selector miss, provider error nội dung) → job `failed`, batch chạy tiếp block sau.
- Lỗi **cấp phiên** (rate limit, chưa đăng nhập) → dừng batch, giữ job hiện tại ở `pending`.

## 5.3 Vòng lặp xử lý (pseudocode)

```ts
async function runLoop(batch: BatchState) {
  while (batch.currentIndex < batch.jobs.length) {
    if (batch.status !== 'running') return;      // paused/stopped/cancelled → thoát
    const job = batch.jobs[batch.currentIndex];

    if (job.status === 'done' || job.status === 'skipped') {
      batch.currentIndex++; continue;            // resume: bỏ qua job đã xong
    }

    setJob(job, 'running');
    const tab = await tabManager.ensureProviderTab(batch.config.provider);
    const ready = await tabManager.ping(tab);    // kiểm tra login + adapter sẵn sàng
    if (!ready.loggedIn) {
      return haltBatch('needs_attention', 'Chưa đăng nhập ' + batch.config.provider, job);
    }

    const res = await tabManager.generate(tab, {
      requestId: uuid(), prompt: job.prompt, kind: job.kind,
      aspectRatio: batch.config.aspectRatio
    }, timeoutFor(job.kind));

    if (res.ok) {
      const fileName = await downloadManager.save(res, job, batch.config);
      job.outputFileName = fileName;
      job.outputMediaType = res.mediaType;
      setJob(job, 'done');
      manifestWriter.record(job, batch.config);
      batch.currentIndex++;
      await delay(randomBetween(batch.config.interBlockDelayMs));  // 5.6
    } else if (res.errorType === 'RATE_LIMIT') {
      return haltBatch('stopped_rate_limit', 'Bị giới hạn bởi ' + batch.config.provider, job);
    } else if (res.errorType === 'NOT_LOGGED_IN') {
      return haltBatch('needs_attention', 'Phiên đăng nhập hết hạn', job);
    } else {
      // lỗi cấp block
      job.lastError = { type: res.errorType, message: res.message };
      if (job.attempts < MAX_AUTO_RETRY && isRetryable(res.errorType)) {
        job.attempts++;
        await delay(RETRY_BACKOFF[job.attempts]);   // 5.4
        // giữ nguyên currentIndex để thử lại chính job này
      } else {
        setJob(job, 'failed');
        batch.currentIndex++;
      }
    }
    await persist(batch);                         // lưu sau mỗi bước
  }
  finishBatch(batch);
}
```

`haltBatch(status, reason, job)`:
- Đặt `job.status = 'pending'` (chưa xong, sẽ chạy lại khi resume).
- `batch.status = status`, `batch.attentionReason = reason`, persist.
- Phát `NEEDS_ATTENTION` lên panel. KHÔNG tăng currentIndex.

## 5.4 Auto-retry cấp block

```ts
const MAX_AUTO_RETRY = 2;                 // tổng 3 lần thử
const RETRY_BACKOFF = [0, 5000, 15000];   // ms theo lần attempt
function isRetryable(t: ErrorType) {
  return t === 'TIMEOUT' || t === 'SELECTOR_MISS' || t === 'PROVIDER_ERROR';
}
```

`DOWNLOAD_FAILED` cũng retry được nhưng ở tầng download (07). `UNSUPPORTED` không retry.

## 5.5 Xử lý rate limit

- Nguồn phát hiện: content script trả `errorType: 'RATE_LIMIT'` (dấu hiệu DOM, xem `09`),
  hoặc worker suy luận khi một provider liên tiếp timeout N lần (fallback).
- Khi nhận: `haltBatch('stopped_rate_limit', ...)`. Panel hiện banner đỏ + nút **Resume**
  và gợi ý "đợi hết giới hạn rồi bấm Resume".
- `RESUME_BATCH`: đặt `batch.status = 'running'`, gọi lại `runLoop` từ `currentIndex`.

## 5.6 Độ trễ giữa các block

- Ngẫu nhiên trong `[min, max]` (mặc định 3–8s) để giảm dấu hiệu bot.
- Không đặt trần cứng số block/phút (theo quyết định sản phẩm) — chỉ có delay + detect rate limit.

## 5.7 Sống sót qua service-worker suspend (MV3)

Service worker MV3 có thể bị kill khi rảnh. Nguyên tắc:
- **Nguồn sự thật là `chrome.storage.local`**, không phải biến in-memory. Persist sau mỗi
  chuyển trạng thái job (đã thấy trong runLoop).
- Khi worker khởi động lại (`chrome.runtime.onStartup` / khi nhận message đầu tiên):
  đọc `BATCH_STATE`. Nếu `status === 'running'` mà worker vừa hồi sinh → có job kẹt ở
  `running`: đưa job đó về `pending` và tiếp tục `runLoop` (idempotent nhờ requestId).
- Trong lúc chờ generate (nhất là video ~ vài phút), dùng `chrome.alarms` giữ nhịp
  "poll/keepalive" thay vì chỉ `await` một promise dài, để worker không bị coi là rảnh.
  (Chi tiết keepalive: đặt alarm ngắn lặp lại trong khi có job `running`.)

## 5.8 Tab manager (`tab-manager.ts`)

- `ensureProviderTab(provider)`: tìm tab đang mở đúng host; nếu không có thì tạo mới
  (`chrome.tabs.create`, có thể `active:false`), chờ `status==='complete'`, rồi đảm bảo
  content script đã inject (ping; nếu không pong thì `chrome.scripting.executeScript`).
- `ping(tab)`: gửi `PING`, chờ `PONG` với timeout ngắn (VD 3s).
- `generate(tab, req, timeout)`: gửi `GENERATE`, chờ `GENERATE_RESULT/ERROR` hoặc timeout.
  Timeout → trả `{ ok:false, errorType:'TIMEOUT' }` và gửi `ABORT` cho content script.
- Chỉ dùng **một** tab cho provider để tránh phức tạp; tuần tự nên không cần nhiều tab.

## 5.9 Persistence (`persistence.ts`)

```ts
export async function persist(batch: BatchState): Promise<void>;   // set STORAGE_KEYS.BATCH_STATE
export async function loadBatch(): Promise<BatchState | null>;
export async function clearBatch(): Promise<void>;                  // khi done/cancel + user xác nhận
```

`updatedAt` cập nhật mỗi lần persist. Panel khi mở gọi `GET_STATE` → worker trả snapshot
từ state in-memory (hoặc load từ storage nếu vừa hồi sinh).
