import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { modelVendorDomain } from '../../../shared/providers';
import { groupModels, type ModelOption } from '../../lib/modelCatalog';
import { cn } from '../../lib/cn';
import ModelIcon from './ModelIcon';

export default function ModelList({ options, value, onSelect }: {
  options: readonly ModelOption[];
  value?: string;
  onSelect: (option: ModelOption) => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const id = useId();
  const groups = useMemo(() => groupModels(options, query), [options, query]);
  const selected = options.find((option) => option.value === value);
  const defaultGroup = selected ? modelVendorDomain(selected.id) ?? 'other' : groups[0]?.id;
  const searching = Boolean(query.trim());

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const input = event.target instanceof HTMLInputElement;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || input && ['Home', 'End'].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-model-navigation]')]
      .filter((item) => !item.disabled && !item.closest('[inert]'));
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
    items[next].focus();
    items[next].scrollIntoView?.({ block: 'nearest' });
  }

  return (
    <div className="flex min-h-0 flex-col" onKeyDown={navigate}>
      <div className="px-3 pb-2 pt-3">
        <div className="flex h-9 items-center gap-2 rounded-lg bg-paper-inset/70 px-2.5 text-ink-muted focus-within:ring-2 focus-within:ring-accent/15">
          <Search size={14} className="shrink-0" />
          <input aria-label="搜索模型或厂商" placeholder="搜索模型或厂商…" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-muted" />
          {query && <button type="button" aria-label="清空模型搜索" onClick={() => setQuery('')} className="rounded p-0.5 hover:text-ink"><X size={13} /></button>}
        </div>
      </div>
      <div className="flex items-center justify-between px-4 pb-2 text-[10px] text-ink-muted">
        <span>{searching ? '搜索结果' : '按厂商选择'}</span>
        <span>{groups.reduce((count, group) => count + group.models.length, 0)} 个模型</span>
      </div>
      <div aria-label="模型列表" className="min-h-0 max-h-[min(340px,45dvh)] overflow-y-auto overscroll-contain px-1.5 pb-2 [scrollbar-gutter:stable]">
        {groups.map((group) => {
          const open = searching || (expanded[group.id] ?? group.id === defaultGroup);
          const current = group.models.some((option) => option.value === value);
          return (
            <section key={group.id} className="mb-0.5">
              <button type="button" data-model-navigation disabled={searching} aria-expanded={open} aria-controls={`${id}-${group.id}`} aria-label={`${group.name}，${group.models.length} 个模型`} onClick={() => setExpanded((previous) => ({ ...previous, [group.id]: !open }))}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-xs outline-none transition-colors hover:bg-paper-inset/70 focus-visible:bg-paper-inset">
                <span className="grid size-6 shrink-0 place-items-center rounded-md border border-line/70 bg-paper-raised"><ModelIcon domain={group.domain} /></span>
                <span className="min-w-0 flex-1 font-medium text-ink">{group.name}</span>
                {current && <span className="rounded bg-paper-inset px-1.5 py-0.5 text-[10px] text-ink-muted">当前</span>}
                <span className="text-[11px] tabular-nums text-ink-muted">{group.models.length}</span>
                <ChevronDown size={13} className={cn('shrink-0 text-ink-muted transition-transform duration-150 motion-reduce:transition-none', !open && '-rotate-90')} />
              </button>
              <div id={`${id}-${group.id}`} inert={!open} aria-hidden={!open} className={cn('grid transition-[grid-template-rows,opacity] duration-150 motion-reduce:transition-none', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
                <div className="min-h-0 overflow-hidden">
                  <div className="ml-5 border-l border-line/80 py-0.5 pl-2">
                    {group.models.map((option) => {
                      const active = option.value === value;
                      return <button key={option.value} type="button" data-model-navigation data-model-value={option.value} aria-pressed={active} onClick={() => onSelect(option)} title={option.id}
                        className={cn('my-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-paper-inset/70 focus-visible:bg-paper-inset', active && 'bg-paper-inset')}>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-[12px] leading-5 text-ink"><span className="truncate">{option.name}</span>{option.badge && <span className="shrink-0 rounded bg-paper-inset px-1 text-[10px] text-ink-muted">{option.badge}</span>}</span>
                          {(option.description || option.source) && <span className="mt-0.5 block truncate text-[10px] leading-4 text-ink-muted">{[option.source, option.description].filter(Boolean).join(' · ')}</span>}
                        </span>
                        <span className="grid size-4 shrink-0 place-items-center">{active && <Check size={13} className="text-ink" />}</span>
                      </button>;
                    })}
                  </div>
                </div>
              </div>
            </section>
          );
        })}
        {!groups.length && <p role="status" className="px-4 py-8 text-center text-xs text-ink-muted">{options.length ? '没有匹配的模型，试试其他关键词' : '暂无可用模型'}</p>}
      </div>
    </div>
  );
}
