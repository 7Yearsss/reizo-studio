import { useState } from 'react';
import type { PendingAsk } from '../../state/chatStore';
import { cn } from '../../lib/cn';

export default function AskUserPrompt({
  pending,
  onAnswer,
}: {
  pending: PendingAsk;
  onAnswer: (answers: Record<string, string>) => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState('');
  const question = pending.questions[index];
  if (!question) return null;

  function commit(value: string) {
    const next = { ...answers, [question.id]: value };
    setAnswers(next);
    setCustom('');
    if (index + 1 < pending.questions.length) setIndex(index + 1);
    else onAnswer(next);
  }

  return (
    <div className="rise-in rounded-[28px] border border-line bg-paper-raised px-5 py-4 shadow-[0_8px_30px_rgba(28,22,18,0.06)]">
      <p className="text-xs text-ink-muted">
        问题 {index + 1} / {pending.questions.length}
      </p>
      <p className="mt-1 text-sm font-medium text-ink">{question.prompt}</p>
      <div className="mt-3 flex flex-col gap-1.5">
        {(question.options ?? []).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => commit(option)}
            className="rounded-xl bg-paper px-3 py-2 text-left text-sm text-ink hover:bg-paper-inset"
          >
            {option}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && custom.trim()) commit(custom.trim());
          }}
          placeholder="自己写答案…"
          className="flex-1 rounded-full bg-paper px-3 py-2 text-sm text-ink outline-none"
        />
        <button
          type="button"
          onClick={() => commit(custom.trim() || '')}
          className={cn('text-sm text-accent', !custom.trim() && 'text-ink-muted')}
        >
          {index + 1 < pending.questions.length ? '下一题' : '提交'}
        </button>
      </div>
    </div>
  );
}
