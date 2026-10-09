import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/cn';

/** Numbered badge for a picked range; the same number marks the range in the workspace and cites it as [n] in the message. */
export function ReferenceLabel({ label, className }: { label: number; className?: string }) {
  return <span className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold leading-none text-accent-ink tabular-nums', className)}>{label}</span>;
}

/** A workspace reference attached to the next message: icon (or range number), name, what part of it, open and remove. */
export default function WorkspaceRefChip({ icon, name, detail, kind, open, remove, pinned, label, cite, className }: {
  icon: ReactNode; name: string; detail: string; kind: string; open(): void; remove?(): void; pinned?: boolean; label?: number; cite?(): void; className?: string;
}) {
  return <div className={cn('flex min-w-0 max-w-[min(100%,20rem)] items-center gap-1.5 rounded-lg border border-line py-0.5 pl-1.5 pr-0.5 text-xs', pinned === false ? 'border-dashed bg-transparent' : 'bg-paper-inset', className)}>
    {label
      ? <button type="button" className="shrink-0 rounded-full outline-offset-2" title={`在消息里写入 [${label}] 指代这段`} aria-label={`在消息中引用第 ${label} 段`} onClick={cite}><ReferenceLabel label={label} /></button>
      : <span className="shrink-0 text-accent [&_svg]:size-3.5">{icon}</span>}
    <button type="button" className="flex min-w-0 flex-1 items-baseline gap-1.5 py-0.5 text-left" title={`${name} · 在${kind}工作区打开`} onClick={open}>
      {/* A numbered range already says which file it is in the workspace; the quote alone keeps several on one line. */}
      {!label && <span className="max-w-[10rem] shrink-0 truncate font-medium">{name}</span>}
      <span className="min-w-0 truncate text-ink-muted">{detail}</span>
    </button>
    {remove && <Button type="button" variant="ghost" size="icon-xs" aria-label={`移除${kind}引用`} title={`移除${kind}引用`} onClick={remove}><X /></Button>}
  </div>;
}
