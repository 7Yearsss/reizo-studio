/**
 * Static catalogue of follow-up actions shown after a turn completes. Each
 * card fires a pre-written prompt. `when` filters by session context so the
 * strip stays short and relevant.
 */
export interface NextStepAction {
  id: string;
  title: string;
  hint: string;
  prompt: string;
  when: 'always' | 'has-artifact' | 'has-text-artifact' | 'has-image-artifact';
}

export interface NextStepContext {
  hasArtifact: boolean;
  hasTextArtifact: boolean;
  hasImageArtifact: boolean;
}

const ACTIONS: NextStepAction[] = [
  {
    id: 'improve-artifact',
    title: '改进作品',
    hint: '挑出最弱的一处并修好',
    prompt:
      '审视你刚才产出的作品，找出最影响质量的一个问题（结构、措辞、视觉层级或事实准确性），只改这一处，然后说明改了什么、为什么。',
    when: 'has-artifact',
  },
  {
    id: 'polish-pass',
    title: '打磨一遍',
    hint: '去掉 AI 味，收紧表达',
    prompt:
      '对刚才的作品做一次打磨：删掉套话和冗余、统一术语、收紧句子、修正明显的排版/格式问题。不要改变结论，只提升成品度。',
    when: 'has-artifact',
  },
  {
    id: 'generate-from-plan',
    title: '按文档生成',
    hint: '把这份文档当作事实来源',
    prompt:
      '把刚才这份 Markdown 文档当作已批准的方案和事实来源，据此生成对应的产物（代码 / HTML / 图表，取决于文档意图）。',
    when: 'has-text-artifact',
  },
  {
    id: 'align-doc-artifact',
    title: '对齐文档与产物',
    hint: '文档是意图，产物是实现',
    prompt:
      '把文档视为意图、产物视为实现，逐条核对两者是否一致。列出偏差，并选择一边为准来调和它们。',
    when: 'has-artifact',
  },
  {
    id: 'variations',
    title: '出几个变体',
    hint: '同一方向的 2-3 个替代',
    prompt: '基于当前图片的方向，生成 2-3 个明显不同的变体（构图 / 配色 / 视角），保留原图不动。',
    when: 'has-image-artifact',
  },
  {
    id: 'next-steps',
    title: '下一步建议',
    hint: '列出 3 个可执行动作',
    prompt: '基于目前的进展，列出接下来最有价值的 3 个具体动作，按优先级排序，每条一句话说明理由。',
    when: 'always',
  },
];

export function pickNextStepActions(ctx: NextStepContext, max = 4): NextStepAction[] {
  const out: NextStepAction[] = [];
  for (const a of ACTIONS) {
    if (a.when === 'always') out.push(a);
    else if (a.when === 'has-artifact' && ctx.hasArtifact) out.push(a);
    else if (a.when === 'has-text-artifact' && ctx.hasTextArtifact) out.push(a);
    else if (a.when === 'has-image-artifact' && ctx.hasImageArtifact) out.push(a);
    if (out.length >= max) break;
  }
  return out;
}
