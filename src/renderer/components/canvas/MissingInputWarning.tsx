import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * A small amber warning badge shown in a node header when the node is not yet
 * ready to run (empty prompt, an @-referenced node with no output, a missing
 * start/end frame source...). Hover reveals the specific reasons.
 */
export default function MissingInputWarning({ messages }: { messages: string[] }) {
  const [open, setOpen] = useState(false);
  if (messages.length === 0) return null;

  return (
    <span
      className="relative inline-flex nodrag"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <AlertTriangle size={12} className="text-amber-500" />
      {open ? (
        <span className="absolute right-0 top-[calc(100%+4px)] z-50 w-max max-w-[220px] rounded-md border border-amber-500/30 bg-paper-raised px-2 py-1.5 text-[10px] leading-relaxed text-ink shadow-lg">
          {messages.map((m, i) => (
            <span key={i} className="flex items-start gap-1">
              <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-amber-500" />
              {m}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}
