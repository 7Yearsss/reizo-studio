import { useState } from 'react';
import { ChevronRight, Wrench } from 'lucide-react';
import type { ToolCallPart } from '../../../main/server/storage/ports';
import { cn } from '../../lib/cn';

export default function ToolCard({ part }: { part: ToolCallPart }) {
  const [open, setOpen] = useState(part.name === 'edit_file' || part.name === 'write_file');
  const path = typeof part.args.path === 'string' ? part.args.path : '';
  const command = typeof part.args.command === 'string' ? part.args.command : '';
  let diff = '';
  if (part.result) {
    try {
      const parsed = JSON.parse(part.result) as { diff?: string };
      if (typeof parsed.diff === 'string') diff = parsed.diff;
    } catch {
      /* raw */
    }
  }
  const body = diff || part.error || part.result || '';

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-paper-raised">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink"
      >
        <Wrench size={13} className="shrink-0 text-ink-muted" />
        <span className="font-medium">{part.name}</span>
        <span className="truncate text-ink-muted">{path || command}</span>
        {part.error && <span className="text-danger">失败</span>}
        <ChevronRight size={13} className={cn('ml-auto shrink-0 text-ink-muted transition', open && 'rotate-90')} />
      </button>
      {open && body && (
        <pre className="max-h-56 overflow-auto border-t border-line bg-paper px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
          {body.slice(0, 4000)}
        </pre>
      )}
    </div>
  );
}
