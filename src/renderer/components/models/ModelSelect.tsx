import { useState } from 'react';
import { Popover } from 'radix-ui';
import { ChevronDown } from 'lucide-react';
import { modelVendorDomain } from '../../../shared/providers';
import type { ModelOption } from '../../lib/modelCatalog';
import ModelIcon from './ModelIcon';
import ModelList from './ModelList';

export const MODEL_POPOVER_CLASS = 'z-[120] flex max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-line bg-paper-raised text-ink shadow-[0_12px_40px_-12px_rgba(0,0,0,0.25)] outline-none motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=closed]:zoom-out-95 duration-150';

export default function ModelSelect({ models, value, onChange, disabled = false }: {
  models: readonly { id: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options: ModelOption[] = models.map((model) => ({ ...model, value: model.id }));
  // Preserve an existing custom choice even if a refreshed catalogue omits it.
  if (value && !options.some((option) => option.value === value)) options.unshift({ id: value, name: value, value });
  const current = options.find((option) => option.value === value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label="默认对话模型" data-selected-model={value} disabled={disabled} className="mt-2 flex w-full min-w-0 items-center gap-2.5 rounded-xl border border-line bg-paper-raised px-3 py-3 text-left outline-none transition-colors hover:border-ink-muted/40 focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-50">
          <ModelIcon domain={modelVendorDomain(value)} />
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{current?.name || '请选择模型'}</span>
          <ChevronDown size={15} className="shrink-0 text-ink-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label="选择默认对话模型" align="start" sideOffset={6} collisionPadding={12} className={`${MODEL_POPOVER_CLASS} w-[var(--radix-popover-trigger-width)] min-w-72`}>
          <ModelList options={options} value={value} onSelect={(option) => { onChange(option.id); setOpen(false); }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
