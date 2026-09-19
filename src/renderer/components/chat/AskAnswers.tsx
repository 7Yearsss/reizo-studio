import { useMemo } from 'react';
import type { ToolCallPart } from '../../../shared/chat';
import type { AskQuestion } from '../../../shared/stream';

interface QaRow {
  key: string;
  prompt: string;
  answer: string;
}

/**
 * Compact "Q: … A: …" rows for ask_user calls that already have answers —
 * the full ask card collapses into this once the turn moves on, so the
 * question's context survives without taking over the stream.
 */
export default function AskAnswers({ parts }: { parts?: ToolCallPart[] }) {
  const rows = useMemo(() => {
    const out: QaRow[] = [];
    for (const part of parts ?? []) {
      if (part.name !== 'ask_user' || !part.result) continue;
      let answers: Record<string, string> = {};
      try {
        answers = (JSON.parse(part.result) as { answers?: Record<string, string> }).answers ?? {};
      } catch {
        continue;
      }
      const questions = (part.args.questions ?? []) as AskQuestion[];
      for (const q of questions) {
        const raw = answers[q.id];
        if (raw === undefined) continue;
        // Direction picks store the direction id — show its title.
        const answer =
          q.kind === 'direction'
            ? (q.directions?.find((d) => d.id === raw)?.title ?? raw)
            : raw;
        // Folded duplicate asks each get a result — show the row once.
        if (out.some((r) => r.prompt === q.prompt && r.answer === answer)) continue;
        out.push({ key: `${part.id}:${q.id}`, prompt: q.prompt, answer });
      }
    }
    return out;
  }, [parts]);

  if (!rows.length) return null;

  return (
    <div className="flex max-w-xl flex-col gap-1 rounded-lg border border-line bg-paper-inset px-3 py-2">
      {rows.map((row) => (
        <div key={row.key} className="flex items-baseline gap-2 text-[12px] leading-5">
          <span className="shrink-0 font-medium text-ink-muted">Q</span>
          <span className="min-w-0 truncate text-ink-muted">{row.prompt}</span>
          <span className="shrink-0 font-medium text-accent">A</span>
          <span className="min-w-0 truncate text-ink">{row.answer}</span>
        </div>
      ))}
    </div>
  );
}
