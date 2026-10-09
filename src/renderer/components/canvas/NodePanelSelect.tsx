import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../ui/select';

export default function NodePanelSelect({ label, value, options, onChange, disabled, boundary }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  boundary?: HTMLElement | null;
}) {
  const choices = value && !options.some((option) => option.value === value) ? [{ value, label: value }, ...options] : options;
  return <Select value={value} onValueChange={onChange} disabled={disabled}>
    <SelectTrigger aria-label={label} size="sm" className="max-w-44"><SelectValue /></SelectTrigger>
    <SelectContent className="max-w-[var(--radix-select-content-available-width)]" collisionBoundary={boundary ?? undefined} collisionPadding={12} onKeyDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <SelectGroup><SelectLabel>{label}</SelectLabel>{choices.map((option) => <SelectItem key={option.value} value={option.value}><span className="max-w-64 truncate">{option.label}</span></SelectItem>)}</SelectGroup>
    </SelectContent>
  </Select>;
}
