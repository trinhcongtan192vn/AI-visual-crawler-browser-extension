import { useStore, goToStep, setJobPrompt, toggleJobSkip, reapplyTemplatesToAll } from '../store';

export function PreviewScreen() {
  const { blocks, jobs, config } = useStore((s) => s);
  const jobByBlockId = new Map(jobs.map((j) => [j.blockId, j]));

  function handleReapply() {
    if (confirm('Áp dụng lại template sẽ ghi đè mọi chỉnh sửa tay trong prompt. Tiếp tục?')) {
      reapplyTemplatesToAll();
    }
  }

  const runnableCount = jobs.filter((j) => j.status !== 'skipped').length;

  return (
    <div className="screen">
      <h2>Xem trước prompt ({blocks.length} block)</h2>
      <p className="small">
        Provider hiện tại: <strong>{config.provider === 'chatgpt' ? 'ChatGPT' : 'Gemini'}</strong> — block video sẽ{' '}
        {config.provider === 'chatgpt' ? 'bị hạ cấp thành ảnh (đổi ở màn Cấu hình để chạy video thật)' : 'chạy qua Veo'}.
      </p>
      <div className="screen-actions">
        <button className="btn btn-secondary" onClick={handleReapply}>Áp dụng template lại</button>
      </div>

      <div className="table-wrap">
        <table className="block-table">
          <thead>
            <tr>
              <th>Mã block</th>
              <th>Loại</th>
              <th>Loại Visual gốc</th>
              <th>Prompt (chỉnh được)</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) => {
              const job = jobByBlockId.get(block.blockId);
              if (!job) return null;
              const isSkipped = job.status === 'skipped';
              return (
                <tr key={block.blockId} className={isSkipped ? 'row-skipped' : undefined}>
                  <td className="cell-blockid">{block.blockId}</td>
                  <td>
                    <span className={`kind-badge kind-${job.kind}`}>{job.kind === 'image' ? 'Ảnh' : 'Video'}</span>
                    {job.downgraded && <span className="downgrade-flag" title="Video bị hạ cấp thành ảnh vì provider = ChatGPT">↓ downgrade</span>}
                  </td>
                  <td className="small">{block.rawVisualType}</td>
                  <td>
                    {isSkipped ? (
                      <div className="skip-note">
                        <span>{block.skipReason || 'Đã bỏ qua'}</span>
                        <button className="btn-link" onClick={() => toggleJobSkip(block.blockId)}>Bật lại</button>
                      </div>
                    ) : (
                      <>
                        <textarea
                          className="prompt-input"
                          value={job.prompt}
                          onChange={(e) => setJobPrompt(block.blockId, e.target.value)}
                          rows={4}
                        />
                        <button className="btn-link" onClick={() => toggleJobSkip(block.blockId)}>Bỏ qua block này</button>
                      </>
                    )}
                    {block.warnings.length > 0 && (
                      <div className="row-warning">{block.warnings.join('; ')}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="screen-actions">
        <button className="btn" onClick={() => goToStep('import')}>Quay lại</button>
        <button className="btn btn-primary" disabled={runnableCount === 0} onClick={() => goToStep('config')}>
          Tiếp tục ({runnableCount} block sẽ chạy)
        </button>
      </div>
    </div>
  );
}
