export function ProgressBar({ done, failed, skipped, total }: { done: number; failed: number; skipped: number; total: number }) {
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="progress-wrap">
      <div className="progress-bar">
        <div className="progress-seg progress-done" style={{ width: `${pct(done)}%` }} />
        <div className="progress-seg progress-failed" style={{ width: `${pct(failed)}%` }} />
        <div className="progress-seg progress-skipped" style={{ width: `${pct(skipped)}%` }} />
      </div>
      <div className="progress-label">
        {done + failed + skipped}/{total} — {done} xong, {failed} lỗi, {skipped} bỏ qua
      </div>
    </div>
  );
}
