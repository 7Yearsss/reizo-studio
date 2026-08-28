import { cn } from '../../lib/cn';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';

export interface SelectOption {
  value: string;
  label: string;
  /** Muted note shown after the label, e.g. "未配置". Disabled options only. */
  hint?: string;
  disabled?: boolean;
  /** Leading status dot — filled accent, or a hollow muted ring. */
  dot?: 'accent' | 'muted';
}

function Dot({ kind }: { kind: 'accent' | 'muted' }) {
  return (
    <span
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        kind === 'accent' ? 'bg-accent' : 'border border-ink-muted/60',
      )}
    />
  );
}

/**
 * Thin `{ value, options, onChange }` wrapper over the shadcn/ui Select
 * primitives, so the three composer dropdowns stay one-liners. Radix owns
 * positioning, dismissal, scroll-follow, focus, and keyboard nav.
 */
export default function SelectField({
  value,
  options,
  onChange,
  ariaLabel,
  align = 'start',
  className,
  disabled = false,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  align?: 'start' | 'end';
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          'h-auto rounded-lg border-0 px-2.5 py-1.5 text-[13px] text-ink shadow-none',
          'hover:bg-paper-inset/60 focus-visible:ring-0 data-[state=open]:bg-paper-inset',
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align={align}>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className="text-[13px]"
          >
            {option.dot && <Dot kind={option.dot} />}
            <span className="min-w-0 truncate">{option.label}</span>
            {option.hint && (
              <span className="shrink-0 text-[11px] text-ink-muted">{option.hint}</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
