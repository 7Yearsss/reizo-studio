import type { ComponentProps, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';
import { useStore } from '@xyflow/react';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { Tooltip } from '../ui/Tooltip';

/** Shared, canvas-sized chrome; the content keeps its own scroll position. */
export default function CanvasUtilityPanel({ title, icon: Icon, description, actions, onClose, children, className, style, ...props }:
  ComponentProps<'aside'> & { title: string; icon: LucideIcon; description?: string; actions?: ReactNode; onClose: () => void }) {
  const canvasWidth = useStore((state) => state.width);
  const canvasHeight = useStore((state) => state.height);
  return <aside {...props} aria-label={title} style={{
    maxWidth: canvasWidth > 0 ? Math.max(0, canvasWidth - 84) : undefined,
    maxHeight: canvasHeight > 0 ? Math.max(0, canvasHeight - 88) : undefined,
    ...style,
  }} className={cn(
    'nowheel nodrag nopan flex max-h-[calc(100dvh-176px)] w-[320px] max-w-[calc(100vw-90px)] flex-col overflow-hidden rounded-2xl border border-line bg-paper-raised/98 shadow-[0_12px_40px_-16px_rgba(28,22,18,0.28)] backdrop-blur-xl', className)}>
    <header className="flex shrink-0 items-center gap-2.5 px-4 py-3">
      <Icon size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
        {description ? <p className="mt-0.5 truncate text-[10px] text-ink-muted">{description}</p> : null}
      </div>
      <div className="flex items-center gap-1">
        {actions}
        <Tooltip content={`收起${title}`}><Button type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label={`收起${title}`}><X /></Button></Tooltip>
      </div>
    </header>
    <Separator />
    {children}
  </aside>;
}
