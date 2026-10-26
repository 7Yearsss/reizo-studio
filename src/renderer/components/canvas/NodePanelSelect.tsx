import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import ModelIcon from '../models/ModelIcon';

export interface NodePanelOption {
  value: string;
  label: string;
  /** Vendor domain (see `modelVendorDomain`); renders the vendor logo before the label. */
  iconDomain?: string;
}

export default function NodePanelSelect({ label, value, options, onChange, disabled, boundary }: {
  label: string;
  value: string;
  options: NodePanelOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  boundary?: HTMLElement | null;
}) {
  const choices = value && !options.some((option) => option.value === value) ? [{ value, label: value }, ...options] : options;
  const withIcons = choices.some((option) => option.iconDomain);
  return <Select value={value} onValueChange={onChange} disabled={disabled}>
    <SelectTrigger aria-label={label} size="sm" className="max-w-44 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5"><SelectValue /></SelectTrigger>
    <SelectContent className="max-w-[var(--radix-select-content-available-width)]" collisionBoundary={boundary ?? undefined} collisionPadding={12} onKeyDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <SelectGroup aria-label={label}>{choices.map((option) => <SelectItem key={option.value} value={option.value}>
        {withIcons ? <ModelIcon domain={option.iconDomain} /> : null}
        <span className="max-w-64 truncate">{option.label}</span>
      </SelectItem>)}</SelectGroup>
    </SelectContent>
  </Select>;
}
