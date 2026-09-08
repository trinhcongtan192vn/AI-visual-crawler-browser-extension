import { useStore, updateConfig, goToStep, startBatch } from '../store';
import { DEFAULT_IMAGE_TEMPLATE, DEFAULT_VIDEO_TEMPLATE } from '../../config/default-templates';
import type { AspectRatio, Provider } from '../../shared/types';

export function ConfigScreen() {
  const { config, jobs } = useStore((s) => s);
  const runnableCount = jobs.filter((j) => j.status !== 'skipped').length;

  return (
    <div className="screen">
      <h2>Cấu hình chạy</h2>

      <fieldset className="field-group">
        <legend>Provider</legend>
        {(['gemini', 'chatgpt'] as Provider[]).map((p) => (
          <label key={p} className="radio-row">
            <input
              type="radio"
              name="provider"
              checked={config.provider === p}
              onChange={() => updateConfig({ provider: p })}
            />
            {p === 'gemini' ? 'Gemini (ảnh + video qua Veo)' : 'ChatGPT (chỉ ảnh — video sẽ bị hạ cấp thành ảnh)'}
          </label>
        ))}
      </fieldset>

      <fieldset className="field-group">
        <legend>Tỷ lệ khung hình</legend>
        {(['16:9', '9:16'] as AspectRatio[]).map((ar) => (
          <label key={ar} className="radio-row">
            <input
              type="radio"
              name="aspectRatio"
              checked={config.aspectRatio === ar}
              onChange={() => updateConfig({ aspectRatio: ar })}
            />
            {ar}
          </label>
        ))}
      </fieldset>

      <fieldset className="field-group">
        <legend>Thư mục lưu (trong Downloads)</legend>
        <input
          className="text-input"
          value={config.outputFolder}
          onChange={(e) => updateConfig({ outputFolder: e.target.value })}
        />
      </fieldset>

      <fieldset className="field-group">
        <legend>Độ trễ giữa các block (ms)</legend>
        <div className="row-inline">
          <label>
            Min
            <input
              type="number"
              className="text-input small-input"
              value={config.interBlockDelayMs.min}
              onChange={(e) => updateConfig({ interBlockDelayMs: { ...config.interBlockDelayMs, min: Number(e.target.value) } })}
            />
          </label>
          <label>
            Max
            <input
              type="number"
              className="text-input small-input"
              value={config.interBlockDelayMs.max}
              onChange={(e) => updateConfig({ interBlockDelayMs: { ...config.interBlockDelayMs, max: Number(e.target.value) } })}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="field-group">
        <legend>Template prompt Ảnh</legend>
        <textarea
          className="prompt-input"
          rows={4}
          value={config.promptTemplates.image}
          onChange={(e) => updateConfig({ promptTemplates: { ...config.promptTemplates, image: e.target.value } })}
        />
        <button className="btn-link" onClick={() => updateConfig({ promptTemplates: { ...config.promptTemplates, image: DEFAULT_IMAGE_TEMPLATE } })}>
          Khôi phục mặc định
        </button>
      </fieldset>

      <fieldset className="field-group">
        <legend>Template prompt Video</legend>
        <textarea
          className="prompt-input"
          rows={4}
          value={config.promptTemplates.video}
          onChange={(e) => updateConfig({ promptTemplates: { ...config.promptTemplates, video: e.target.value } })}
        />
        <button className="btn-link" onClick={() => updateConfig({ promptTemplates: { ...config.promptTemplates, video: DEFAULT_VIDEO_TEMPLATE } })}>
          Khôi phục mặc định
        </button>
      </fieldset>

      <fieldset className="field-group">
        <legend>Prefix / Suffix chung (tùy chọn)</legend>
        <input
          className="text-input"
          placeholder="Prefix — chèn đầu mọi prompt"
          value={config.promptPrefix ?? ''}
          onChange={(e) => updateConfig({ promptPrefix: e.target.value })}
        />
        <input
          className="text-input"
          placeholder="Suffix — chèn cuối mọi prompt"
          value={config.promptSuffix ?? ''}
          onChange={(e) => updateConfig({ promptSuffix: e.target.value })}
        />
      </fieldset>

      <div className="screen-actions">
        <button className="btn" onClick={() => goToStep('preview')}>Quay lại</button>
        <button className="btn btn-primary" disabled={runnableCount === 0} onClick={startBatch}>
          Bắt đầu ({runnableCount} block)
        </button>
      </div>
    </div>
  );
}
