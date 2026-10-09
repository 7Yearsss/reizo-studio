import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/cn';

/** A workspace reference attached to the next message: icon, name, what part of it, open and remove. */
export default function WorkspaceRefChip({ icon, name, detail, kind, open, remove, pinned, className }: {
  icon: ReactNode; name: string; detail: string; kind: string; open(): void; remove?(): void; pinned?: boolean; className?: string;
}) {
  return <div className={cn('flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-line py-0.5 pl-2 pr-0.5 text-xs', pinned === false ? 'border-dashed bg-transparent' : 'bg-paper-inset', className)}>
    <span className="shrink-0 text-accent [&_svg]:size-3.5">{icon}</span>
    <button type="button" className="flex min-w-0 flex-1 items-baseline gap-1.5 py-0.5 text-left" title={`在${kind}工作区打开`} onClick={open}>
      <span className="max-w-[12rem] shrink-0 truncate font-medium">{name}</span>
      <span className="min-w-0 truncate text-ink-muted">{detail}</span>
    </button>
    {remove && <Button type="button" variant="ghost" size="icon-xs" aria-label={`移除${kind}引用`} title={`移除${kind}引用`} onClick={remove}><X /></Button>}
  </div>;
}
