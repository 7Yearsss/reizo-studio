import { cn } from '../../../lib/cn';

export default function EditSlider({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
  className,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  className?: string;
}) {
  return (
    <label className={cn('grid grid-cols-[48px_1fr_56px] items-center gap-3 text-[12px]', className)}>
      <span className="text-ink-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="edit-slider"
      />
      <span className="text-right tabular-nums text-ink">{display}</span>
    </label>
  );
}
