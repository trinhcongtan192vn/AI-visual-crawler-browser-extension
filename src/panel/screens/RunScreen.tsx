import { useStore, pauseBatch, resumeBatch, retryJob, retryAllFailed, cancelBatch, exportManifest } from '../store';
import { StatusBadge } from '../components/StatusBadge';
import { ProgressBar } from '../components/ProgressBar';
import type { BatchStatus } from '../../shared/types';

const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  idle: 'Chưa chạy',
  running: 'Đang chạy',
  paused: 'Tạm dừng',
  stopped_rate_limit: 'Dừng — chạm giới hạn',
  needs_attention: 'Cần chú ý',
  done: 'Hoàn tất',
  cancelled: 'Đã hủy'
};

export function RunScreen() {
  const batch = useStore((s) => s.batch);

  if (!batch) {
    return (
      <div className="screen">
        <h2>Chạy</h2>
        <p>Chưa có batch nào đang chạy. Quay lại màn Cấu hình để bắt đầu.</p>
      </div>
    );
  }

  const hasFailed = batch.jobs.some((j) => j.status === 'failed');
  const isRunning = batch.status === 'running';
  const canResume = batch.status === 'paused' || batch.status === 'stopped_rate_limit' || batch.status === 'needs_attention';

  return (
    <div className="screen">
      <h2>Đang chạy — {batch.config.outputFolder}</h2>

      <div className={`batch-status batch-status-${batch.status}`}>{BATCH_STATUS_LABEL[batch.status]}</div>

      <ProgressBar done={batch.counters.done} failed={batch.counters.failed} skipped={batch.counters.skipped} total={batch.counters.total} />

      {(batch.status === 'stopped_rate_limit' || batch.status === 'needs_attention') && batch.attentionReason && (
        <div className="alert alert-error">
          <strong>{batch.attentionReason}</strong>
          <div className="small">
            {batch.status === 'stopped_rate_limit'
              ? 'Đợi hết giới hạn rồi bấm Tiếp tục.'
              : 'Đăng nhập lại / kiểm tra tab provider rồi bấm Tiếp tục.'}
          </div>
        </div>
      )}

      <div className="screen-actions">
        {isRunning && <button className="btn" onClick={pauseBatch}>Tạm dừng</button>}
        {canResume && <button className="btn btn-primary" onClick={resumeBatch}>Tiếp tục</button>}
        {hasFailed && <button className="btn" onClick={retryAllFailed}>Retry tất cả lỗi</button>}
        {batch.status !== 'done' && batch.status !== 'cancelled' && (
          <button className="btn btn-danger" onClick={cancelBatch}>Hủy batch</button>
        )}
        <button className="btn" onClick={() => chrome.tabs.create({ url: 'chrome://downloads' })}>Mở thư mục tải</button>
        <button className="btn" onClick={exportManifest}>Xuất manifest.csv</button>
      </div>

      <div className="table-wrap">
        <table className="block-table">
          <thead>
            <tr>
              <th>Mã block</th>
              <th>Loại</th>
              <th>Trạng thái</th>
              <th>Lần thử</th>
              <th>File</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {batch.jobs.map((job) => (
              <tr key={job.blockId} className={job.status === 'running' ? 'row-running' : undefined}>
                <td className="cell-blockid">{job.blockId}</td>
                <td>
                  <span className={`kind-badge kind-${job.kind}`}>{job.kind === 'image' ? 'Ảnh' : 'Video'}</span>
                  {job.downgraded && <span className="downgrade-flag">↓</span>}
                </td>
                <td><StatusBadge status={job.status} /></td>
                <td>{job.attempts}</td>
                <td className="small">
                  {job.outputFileName ?? (job.lastError ? `${job.lastError.type}: ${job.lastError.message}` : '—')}
                </td>
                <td>
                  {job.status === 'failed' && (
                    <button className="btn-link" onClick={() => retryJob(job.blockId)}>Retry</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {batch.status === 'done' && (
        <div className="alert alert-info">
          Hoàn tất: {batch.counters.done} xong / {batch.counters.failed} lỗi / {batch.counters.skipped} bỏ qua.
          File nằm trong <code>Downloads/{batch.config.outputFolder}/</code>.
        </div>
      )}
    </div>
  );
}
