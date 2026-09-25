import { useEffect, useMemo, useRef, useState } from 'react';
import { Timer } from 'lucide-react';
import type { PendingAsk } from '../../state/chatStore';
import { computeRecommendedAnswers } from '../../../shared/askAutoResolve';
import { ApprovalCard } from '../agents/approval-card';
import DirectionCardChoice from './DirectionCard';
import { cn } from '../../lib/cn';

/** Seconds before a fully-recommended ask resolves itself (ZCode-style autoResolution). */
const AUTO_RESOLVE_SECONDS = 30;

export default function AskUserPrompt({
  pending,
  onAnswer,
  sessionId,
}: {
  pending: PendingAsk;
  onAnswer: (answers: Record<string, string>) => void;
  sessionId?: string;
}) {
  const hasDirections = pending.questions.some(
    (q) => q.kind === 'direction' && q.directions && q.directions.length > 0,
  );
  const autoAnswers = useMemo(() => computeRecommendedAnswers(pending.questions), [pending.questions]);
  const [snoozed, setSnoozed] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(AUTO_RESOLVE_SECONDS);
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    setSnoozed(false);
    setRemaining(AUTO_RESOLVE_SECONDS);
    setDeadline(autoAnswers ? Date.now() + AUTO_RESOLVE_SECONDS * 1000 : null);
  }, [pending.id, autoAnswers]);

  useEffect(() => {
    if (deadline === null || !autoAnswers || snoozed || firedRef.current) return;
    const timer = setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(timer);
        if (!firedRef.current) {
          firedRef.current = true;
          onAnswer(autoAnswers);
        }
        return;
      }
      setRemaining(left);
    }, 500);
    return () => clearInterval(timer);
  }, [deadline, snoozed, autoAnswers, onAnswer]);

  const snooze = () => setSnoozed(true);

  return (
    <div onPointerDownCapture={autoAnswers ? snooze : undefined}>
      {autoAnswers && !snoozed && (
        <div className="mb-1.5 flex items-center gap-2 rounded-full border border-line bg-paper-raised px-3 py-1 text-[11px] text-ink-muted">
          <Timer size={11} className="shrink-0 text-success" />
          <span className="shrink-0">{remaining}s 后自动选择推荐项</span>
          <span className="h-0.5 min-w-0 flex-1 overflow-hidden rounded-full bg-paper-inset">
            <span
              className="block h-full rounded-full bg-success transition-[width] duration-500 ease-linear"
              style={{ width: `${(remaining / AUTO_RESOLVE_SECONDS) * 100}%` }}
            />
          </span>
          <button
            type="button"
            onClick={snooze}
            className="shrink-0 rounded-full px-1.5 py-0.5 text-ink transition-colors hover:bg-paper-inset"
          >
            暂停
          </button>
        </div>
      )}
      {hasDirections ? (
        <DirectionAsk pending={pending} onAnswer={onAnswer} sessionId={sessionId} />
      ) : (
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
          className="rise-in max-h-[70vh] overflow-y-auto bg-paper-raised"
        />
      )}
    </div>
  );
}

function DirectionAsk({
  pending,
  onAnswer,
  sessionId,
}: {
  pending: PendingAsk;
  onAnswer: (answers: Record<string, string>) => void;
  sessionId?: string;
}) {
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});

  const complete = pending.questions.every((q) => {
    if (q.kind === 'direction') return Boolean(picks[q.id]);
    return true;
  });

  return (
    // Long asks (e.g. an 8-question skill card) used to grow the composer overlay
    // past the viewport — everything above the fold became unreachable. Cap the
    // card and scroll the question list so every question stays clickable, while
    // the title and submit stay pinned.
    <div className="rise-in flex max-h-[70vh] flex-col gap-3 rounded-xl border border-line bg-paper-raised p-3">
      <span className="text-xs font-semibold">选一个方向</span>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {pending.questions.map((q) => (
        <div key={q.id} className="flex flex-col gap-2">
          <span className="text-[12px] text-ink">{q.prompt}</span>
          {q.kind === 'direction' && q.directions ? (
            <div
              className={cn(
                'grid grid-cols-1 gap-2',
                q.directions.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
              )}
            >
              {q.directions.map((d) => (
                <DirectionCardChoice
                  key={d.id}
                  direction={d}
                  selected={picks[q.id] === d.id}
                  onPick={() => setPicks((p) => ({ ...p, [q.id]: d.id }))}
                  sessionId={sessionId}
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
      </div>
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
