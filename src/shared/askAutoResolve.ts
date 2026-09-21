import type { AskQuestion } from './stream';

/**
 * Answers an ask card would submit if the countdown runs out: every question
 * needs a `recommended` value that actually resolves — a listed option, a
 * direction id, or (free-text) any non-empty string. Returns null when any
 * question can't resolve, so the card stays manual. Multi-select questions
 * never auto-resolve.
 */
export function computeRecommendedAnswers(questions: AskQuestion[]): Record<string, string> | null {
  if (questions.length === 0) return null;
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const recommended = q.recommended?.trim();
    if (!recommended || q.multi) return null;
    if (q.kind === 'direction') {
      if (!q.directions?.some((d) => d.id === recommended)) return null;
      answers[q.id] = recommended;
      continue;
    }
    if (q.options && q.options.length > 0) {
      if (!q.options.includes(recommended)) return null;
      answers[q.id] = recommended;
      continue;
    }
    answers[q.id] = recommended;
  }
  return answers;
}
