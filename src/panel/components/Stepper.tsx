import type { Step } from '../store';

const STEPS: { key: Step; label: string }[] = [
  { key: 'import', label: '1. Import' },
  { key: 'preview', label: '2. Preview' },
  { key: 'config', label: '3. Cấu hình' },
  { key: 'run', label: '4. Chạy' }
];

export function Stepper({ current, onSelect }: { current: Step; onSelect: (s: Step) => void }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="stepper">
      {STEPS.map((s, i) => (
        <button
          key={s.key}
          className={`stepper-item${s.key === current ? ' active' : ''}${i <= currentIdx ? ' visited' : ''}`}
          onClick={() => i <= currentIdx && onSelect(s.key)}
          disabled={i > currentIdx}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
