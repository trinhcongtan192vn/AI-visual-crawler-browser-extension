import type { JobStatus } from '../../shared/types';

const LABELS: Record<JobStatus, string> = {
  pending: 'Chờ',
  running: 'Đang chạy',
  done: 'Xong',
  failed: 'Lỗi',
  skipped: 'Bỏ qua'
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`badge badge-${status}`}>{LABELS[status]}</span>;
}
