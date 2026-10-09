export const EMPTY_CHAT_HINTS = [
  { label: '审查代码', text: '请审查当前工作区里最值得修的问题。' },
  { label: '解释代码', text: '解释当前工作区的核心流程。' },
  { label: '写 commit', text: '根据 git diff 写一条 commit message。' },
  { label: '开始创作', text: '帮我开始一个新项目，先问我目标和约束。' },
] as const;

const CANVAS_HINTS = [
  { label: '规划创作', text: '帮我规划这个画布的创作流程，先确认目标、受众和交付要求。' },
  { label: '整理画布', text: '检查当前画布的节点与依赖，给出清晰的分组和布局建议。' },
  { label: '完善选区', text: '帮我完善选中的内容，先分析现有素材和需要补充的部分。' },
  { label: '检查交付', text: '检查当前画布的交付物是否完整，列出缺失内容和待确认项。' },
] as const;

export default function EmptyChatHints({ onPick, context = 'chat' }: { onPick: (text: string) => void; context?: 'chat' | 'canvas' }) {
  return (
    <div className="anim-fade flex flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-[15px] font-medium text-ink">{context === 'canvas' ? '从画布开始创作' : '开始这段对话'}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{context === 'canvas' ? '选中节点可带入上下文，也可以先描述目标' : '选一个提示填入输入框，或直接输入'}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {(context === 'canvas' ? CANVAS_HINTS : EMPTY_CHAT_HINTS).map((hint) => (
          <button
            key={hint.label}
            type="button"
            onClick={() => onPick(hint.text)}
            className="rounded-full border border-line bg-paper-raised px-3 py-1.5 text-xs text-ink transition-colors duration-150 hover:border-accent/40 hover:bg-paper-inset/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {hint.label}
          </button>
        ))}
      </div>
    </div>
  );
}
