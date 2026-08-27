export const EMPTY_CHAT_HINTS = [
  { label: '审查代码', text: '请审查当前工作区里最值得修的问题。' },
  { label: '解释代码', text: '解释当前工作区的核心流程。' },
  { label: '写 commit', text: '根据 git diff 写一条 commit message。' },
  { label: '开始创作', text: '帮我开始一个新项目，先问我目标和约束。' },
] as const;

export default function EmptyChatHints({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="anim-fade flex flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-[15px] font-medium text-ink">开始这段对话</p>
      <p className="mt-1 text-xs text-ink-muted">选一个提示填入输入框，或直接输入</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {EMPTY_CHAT_HINTS.map((hint) => (
          <button
            key={hint.label}
            type="button"
            onClick={() => onPick(hint.text)}
            className="rounded-full border border-line bg-paper-raised px-3 py-1.5 text-xs text-ink transition-colors duration-150 hover:border-accent/40 hover:bg-paper-inset/70"
          >
            {hint.label}
          </button>
        ))}
      </div>
    </div>
  );
}
