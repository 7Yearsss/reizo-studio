import { useState } from 'react';
import type { PendingAsk } from '../../state/chatStore';
import { ApprovalCard } from '../agents/approval-card';
import DirectionCardChoice from './DirectionCard';

export default function AskUserPrompt({
  pending,
  onAnswer,
}: {
  pending: PendingAsk;
  onAnswer: (answers: Record<string, string>) => void;
}) {
  const hasDirections = pending.questions.some(
    (q) => q.kind === 'direction' && q.directions && q.directions.length > 0,
  );

  if (hasDirections) {
    return <DirectionAsk pending={pending} onAnswer={onAnswer} />;
  }

  return (
    <ApprovalCard
      title="需要你选一下"
      questions={pending.questions.map((question) => ({
        id: question.id,
        title: question.prompt,
        options: (question.options ?? []).map((option) => ({ value: option, label: option })),
        multiple: Boolean(question.multi),
        allowCustom: true,
        customPlaceholder: '自己写答案…',
        autoAdvance: !question.multi,
      }))}
      status="pending"
      submitLabel="提交"
      onSubmit={(answers) => {
        const next: Record<string, string> = {};
        for (const [id, answer] of Object.entries(answers)) {
          next[id] = answer.custom?.trim() || answer.selected.join(', ');
        }
        onAnswer(next);
      }}
      className="rise-in bg-paper-raised"
    />
  );
}

function DirectionAsk({
  pending,
  onAnswer,
}: {
  pending: PendingAsk;
  onAnswer: (answers: Record<string, string>) => void;
}) {
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});

  const complete = pending.questions.every((q) => {
    if (q.kind === 'direction') return Boolean(picks[q.id]);
    return true;
  });

  return (
    <div className="rise-in flex flex-col gap-3 rounded-xl border border-line bg-paper-raised p-3">
      <span className="text-xs font-semibold">选一个方向</span>
      {pending.questions.map((q) => (
        <div key={q.id} className="flex flex-col gap-2">
          <span className="text-[12px] text-ink">{q.prompt}</span>
          {q.kind === 'direction' && q.directions ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {q.directions.map((d) => (
                <DirectionCardChoice
                  key={d.id}
                  direction={d}
                  selected={picks[q.id] === d.id}
                  onPick={() => setPicks((p) => ({ ...p, [q.id]: d.id }))}
                />
              ))}
            </div>
          ) : q.options && q.options.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setPicks((p) => ({ ...p, [q.id]: opt }))}
                  className={[
                    'rounded-full px-2.5 py-1 text-[11px]',
                    picks[q.id] === opt ? 'bg-accent text-white' : 'bg-paper-inset text-ink',
                  ].join(' ')}
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : (
            <input
              value={freeText[q.id] ?? ''}
              onChange={(e) => {
                setFreeText((f) => ({ ...f, [q.id]: e.target.value }));
                setPicks((p) => ({ ...p, [q.id]: e.target.value }));
              }}
              placeholder="输入…"
              className="rounded-lg border border-line bg-paper px-2 py-1 text-[12px] outline-none"
            />
          )}
        </div>
      ))}
      <button
        type="button"
        disabled={!complete}
        onClick={() => onAnswer(picks)}
        className="self-end rounded-full bg-accent px-3 py-1 text-[12px] text-white disabled:opacity-40"
      >
        确定
      </button>
    </div>
  );
}
