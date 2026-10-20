import type { SkillSummary } from '../../state/skillStore';

export interface GuideTool {
  id: string;
  label: string;
  description: string;
  prompt: string;
  skillId?: string;
}

export interface GuideCategory {
  label: string;
  description: string;
  tools: GuideTool[];
  skillCategories?: string[];
  skillIds?: string[];
}

function tool(id: string, label: string, description: string, prompt: string): GuideTool {
  return { id, label, description, prompt };
}

export const GUIDE_CATEGORIES: GuideCategory[] = [
  { label: '引导帮助', description: '还没想好从哪里开始？说说目标，我帮你拆成可执行的步骤。', tools: [
    tool('plan', '拆解任务', '从目标到可执行的步骤', '请帮我梳理目标、需要的材料和执行步骤。我的目标是：'),
    tool('ideas', '头脑风暴', '探索方向，比较不同方案', '请围绕以下想法提出几种不同方向，并比较适用场景。我的想法是：'),
    tool('summary', '整理材料', '提取重点、结论与待办', '请整理我提供的材料，提取重点、结论和待办事项。材料：'),
    tool('decision', '方案比较', '理清选项、收益和取舍', '请帮我比较几个方案，列出收益、限制和适用条件。要做的决定：'),
  ] },
  { label: '写作', description: '想写点什么？告诉我主题、读者、风格和篇幅。', skillCategories: ['writing'], tools: [
    tool('wechat', '公众号文章', '吸睛标题 · 深度观点 · 互动引导', '请帮我写一篇公众号文章，提供标题备选、清晰的观点结构和结尾互动引导。主题：\n目标读者：\n风格和篇幅：'),
    tool('xiaohongshu', '小红书种草笔记', '真实体验感的分享风格', '请帮我写一篇小红书种草笔记，包含标题、正文和话题标签。根据我提供的事实写作，不编造亲身体验。主题或产品：\n真实体验与亮点：\n目标读者：'),
    tool('writing-styles', '多风格对比写作', '同一主题，生成三种风格', '请针对同一主题，分别用专业、轻松和故事化三种风格写作，便于对比选择。主题：\n目标读者：\n篇幅：'),
    tool('daily-post', '自媒体日更文', '300–500 字碎片化短文', '请帮我写一篇 300–500 字的自媒体日更短文，围绕一个具体观点展开。主题或素材：\n发布平台：\n希望的语气：'),
  ] },
  { label: 'PPT', description: '告诉我演示主题、听众和页数，从大纲开始制作演示文稿。', skillCategories: ['presentation'], skillIds: ['deck-maker'], tools: [
    tool('deck-outline', '演示大纲', '先理清主线与逐页内容', '请帮我规划一份 PPT，先给出故事主线和逐页大纲。主题：\n听众：\n页数：'),
    tool('project-deck', '项目汇报', '进展、成果、问题与下一步', '请帮我制作项目汇报 PPT，包含进展、成果、问题和下一步计划。项目背景：\n汇报素材：\n预计页数：'),
    tool('pitch-deck', '产品介绍', '从用户痛点讲清产品价值', '请帮我规划产品介绍 PPT，突出用户痛点、产品方案和使用场景。产品：\n目标听众：\n预计页数：'),
    tool('training-deck', '培训课件', '知识讲解搭配案例练习', '请帮我规划培训课件，包含知识讲解、案例和练习。培训主题：\n学员基础：\n课程时长：'),
  ] },
  { label: '调研报告', description: '明确调研问题、范围和时间，整理信息并注明来源。', skillCategories: ['research'], tools: [
    tool('industry', '行业研究', '市场现状、趋势与机会', '请调研以下行业的现状、主要参与者和发展趋势，注明信息日期与来源。行业与地区：\n时间范围：'),
    tool('competitors', '竞品对比', '定位、功能、交互与差异', '请对比以下竞品的定位、功能、交互和差异，并注明来源。竞品：\n重点关注：'),
    tool('topic-research', '专题调研', '围绕一个问题组织证据', '请围绕以下问题做专题调研，区分事实与推断，并注明来源。问题：\n范围与时间：'),
    tool('research-summary', '资料综述', '整理已有资料，提炼结论', '请基于我提供的资料整理综述，提炼共识、分歧和信息缺口。研究主题：\n资料：'),
  ] },
  { label: '需求分析', description: '从使用场景出发，梳理用户需求、功能流程和验收标准。', skillCategories: ['product'], tools: [
    tool('prd', '需求文档', '从想法整理成产品需求', '请帮我整理产品需求文档，包含目标、用户场景、功能范围和验收标准。产品想法：\n目标用户：'),
    tool('user-stories', '用户故事', '角色、场景与期望结果', '请将以下需求拆成用户故事，并补充验收条件。用户角色：\n需求描述：'),
    tool('interaction-flow', '交互流程', '梳理操作路径与异常状态', '请帮我梳理以下功能的交互流程，包括主要路径、空状态、加载和错误处理。功能与场景：'),
    tool('mvp', 'MVP 范围', '确定首版重点与功能优先级', '请帮我明确 MVP 的核心目标、功能优先级和首版验收标准。产品想法：\n时间与资源限制：'),
  ] },
  { label: '视频', description: '描述主题、时长和风格，先规划脚本与分镜，再开始创作。', skillCategories: ['video'], tools: [
    tool('video-script', '视频脚本', '主题、结构、旁白与字幕', '请帮我写一份视频脚本，包含镜头内容、旁白和字幕。主题：\n时长：\n风格：'),
    tool('storyboard', '分镜规划', '按镜头拆解画面和节奏', '请帮我规划视频分镜，逐镜写清画面、动作、景别和时长。故事或主题：\n已有素材：'),
    tool('editing-plan', '剪辑方案', '安排素材、转场与音乐', '请基于以下素材规划剪辑方案，包括镜头顺序、节奏、字幕和配乐方向。素材说明：\n目标时长：'),
    tool('short-video', '短视频策划', '开场吸引点与完整叙事', '请帮我策划一条短视频，先设计开场吸引点、内容结构和结尾。主题：\n平台与受众：\n时长：'),
  ] },
  { label: '数据分析', description: '提供表格和想回答的问题，梳理数据、分析结论与图表。', skillCategories: ['data'], tools: [
    tool('data-clean', '数据整理', '检查缺失、重复与格式', '请帮我检查并整理数据，先说明缺失值、重复项和格式问题。数据说明：\n整理目标：'),
    tool('data-insights', '指标分析', '从数据中提炼可验证的结论', '请分析以下数据的核心指标和变化，区分观察与推断。数据说明：\n我要回答的问题：'),
    tool('data-charts', '图表方案', '为问题选择合适的图表', '请为以下数据规划合适的可视化图表，并解释每张图回答的问题。数据字段：\n展示目的：'),
    tool('data-report', '分析报告', '汇总发现、依据与行动建议', '请根据以下数据整理分析报告，包含主要发现、数据依据和行动建议。数据说明：\n分析目标：'),
  ] },
  { label: '代码开发', description: '描述要实现的功能、技术栈和约束，一起拆解实现步骤。', skillCategories: ['dev'], tools: [
    tool('build-feature', '功能开发', '先拆解方案，再实现功能', '请帮我实现一个功能，先梳理实现方案。功能目标：\n技术栈：\n已有项目和约束：'),
    tool('debug', '排查问题', '从复现现象定位原因', '请帮我排查以下问题。预期行为：\n实际表现：\n复现步骤与报错：'),
    tool('code-explain', '代码解读', '理解入口、数据流和关键逻辑', '请解释以下代码的入口、数据流和关键逻辑。代码或文件：\n我最想理解的部分：'),
    tool('code-review', '代码审查', '检查正确性、边界与维护成本', '请审查以下代码，重点检查正确性、边界条件和可维护性。代码或文件：\n背景与预期行为：'),
  ] },
];

export function categorySkills(category: GuideCategory, skills: SkillSummary[]): GuideTool[] {
  return skills.filter((skill) => category.skillIds?.includes(skill.id) || (skill.category && category.skillCategories?.includes(skill.category)))
    .map((skill) => ({ id: `skill:${skill.id}`, label: skill.name, description: skill.description, prompt: skill.prompt || `请使用「${skill.name}」帮助我完成以下任务：`, skillId: skill.id }));
}

/** Replace only an untouched template; never erase user edits when changing tools. */
export function insertGuidePrompt(draft: string, previous: GuideTool | null, next: GuideTool): string {
  if (!draft.trim() || draft === previous?.prompt) return next.prompt;
  if (draft === next.prompt || draft.endsWith(`\n\n${next.prompt}`)) return draft;
  return `${draft}\n\n${next.prompt}`;
}
