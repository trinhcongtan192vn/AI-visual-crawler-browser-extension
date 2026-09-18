import { useRef, useState } from 'react';
import { parseExcelFile, ParseError } from '../excel/parser';
import { useStore, loadParsedFile, setParseError, goToStep, setVideoContext } from '../store';
import { createLogger } from '../../shared/logger';

const log = createLogger('ImportScreen');

export function ImportScreen() {
  const { fileName, stats, fileWarnings, parseError, blocks, config } = useStore((s) => s);
  const [dragOver, setDragOver] = useState(false);
  const [headersFound, setHeadersFound] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    try {
      const result = await parseExcelFile(file);
      loadParsedFile(file.name, result);
      setHeadersFound([]);
    } catch (err) {
      if (err instanceof ParseError) {
        setParseError(err.message);
        setHeadersFound(err.headersFound);
      } else {
        setParseError(String(err));
        log.error(err);
      }
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const validCount = blocks.filter((b) => !b.skip).length;

  return (
    <div className="screen">
      <h2>Nhập file kịch bản Excel</h2>
      <div
        className={`dropzone${dragOver ? ' dragover' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <p>Kéo-thả file .xlsx / .csv vào đây, hoặc bấm để chọn file</p>
        {fileName && <p className="dropzone-filename">Đã nạp: {fileName}</p>}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      <fieldset className="field-group">
        <legend>Nội dung chính của video (tùy chọn)</legend>
        <textarea
          className="prompt-input"
          rows={3}
          placeholder="VD: Video giới thiệu 5 địa điểm du lịch Đà Lạt cho giới trẻ, phong cách năng động, hài hước..."
          value={config.videoContext ?? ''}
          onChange={(e) => setVideoContext(e.target.value)}
        />
        <div className="small">
          Nếu điền, nội dung này sẽ được gửi làm tin nhắn đầu tiên cho AI trước khi chạy block nào, để AI hiểu ngữ
          cảnh chung của cả video. Để trống nếu không cần.
        </div>
      </fieldset>

      {parseError && (
        <div className="alert alert-error">
          <strong>Không đọc được file:</strong> {parseError}
          {headersFound.length > 0 && (
            <div className="small">Header đọc được: {headersFound.filter(Boolean).join(', ') || '(rỗng)'}</div>
          )}
        </div>
      )}

      {stats && (
        <div className="stats-grid">
          <div className="stat-card"><span className="stat-num">{stats.total}</span><span>Tổng block</span></div>
          <div className="stat-card"><span className="stat-num">{stats.images}</span><span>Ảnh</span></div>
          <div className="stat-card"><span className="stat-num">{stats.videos}</span><span>Video</span></div>
          <div className="stat-card"><span className="stat-num">{stats.skipped}</span><span>Bỏ qua</span></div>
        </div>
      )}

      {fileWarnings.length > 0 && (
        <div className="alert alert-warn">
          <strong>Cảnh báo ({fileWarnings.length}):</strong>
          <ul>
            {fileWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="screen-actions">
        <button className="btn btn-primary" disabled={validCount === 0} onClick={() => goToStep('preview')}>
          Tiếp tục ({validCount} block hợp lệ)
        </button>
      </div>
    </div>
  );
}
