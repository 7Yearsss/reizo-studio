import type { PendingAsk } from '../../state/chatStore';
import { ApprovalCard } from '../agents/approval-card';

export default function AskUserPrompt({
  pending,
  onAnswer,
}: {
  pending: PendingAsk;
  onAnswer: (answers: Record<string, string>) => void;
}) {
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
