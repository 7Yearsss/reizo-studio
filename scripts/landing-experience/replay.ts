import homeScenes from './home-scenes.json';

/** One canvas node the agent "creates" during a replayed step. */
export interface ReplayNode {
  id: string;
  type: 'note' | 'image' | 'video';
  title: string;
  x: number; y: number; w: number; h: number;
  params: Record<string, unknown>;
  /** Media assets start "running" and finish with this output. */
  asset?: string;
  /** Upstream node ids — edges are drawn as the node lands. */
  from?: string[];
}
export interface ReplayStep { title: string; thinking: string; nodes: ReplayNode[] }
export interface ReplayScene { id: string; title: string; prompt: string; thinking: string; response: string; steps: ReplayStep[] }

type SceneKey = keyof typeof homeScenes;
const W = 320, H = 260;
const grid = (i: number) => ({ x: 40 + (i % 3) * 360, y: 40 + Math.floor(i / 3) * 300 });
const note = (id: string, title: string, i: number, content: string, from?: string[]): ReplayNode =>
  ({ id, type: 'note', title, ...grid(i), w: W, h: H, params: { content, color: 'slate' }, from });
const image = (id: string, title: string, x: number, y: number, h: number, asset: string, from?: string[]): ReplayNode =>
  ({ id, type: 'image', title, x, y, w: 250, h, params: { prompt: title, size: '1024x1536' }, asset, from });

/** Deliverable content per step. Sample data only — no real brands, contracts or study results. */
const deliverables: Record<Exclude<SceneKey, 'video' | 'design'>, string[]> = {
  marketing: [
    '### 受众与主题\n\n**核心人群**\n25–35 岁城市通勤者，关注居家质感与周末放松。\n\n**三条主线**\n通勤小物 / 居家角落 / 周末出走',
    '### 平台表达\n\n**小红书**\n图文清单、真实体验笔记，强调收藏价值。\n\n**抖音**\n15 秒生活片段，第一句话直接进入场景。',
    '### 文案与脚本 · 周三\n\n**标题 A** 下班后的 20 分钟，留给自己\n**标题 B** 小房间也能有的仪式感\n\n**脚本**\n开门 → 放下包 → 点灯 → 一杯热茶 → 产品自然入镜',
    '### 7 天发布日历\n\n**周一** 图文 · 通勤清单\n**周二** 短视频 · 早晨 15 秒\n**周三** 图文 · 居家角落\n**周四** 短视频 · 下班仪式\n**周五** 图文 · 周末计划\n**周末** 用户共创征集',
  ],
  website: [
    '### 网站结构\n\n- 首页 · 酒庄故事\n- 葡萄园 · 风土与年份\n- 葡萄酒系列 · 详情\n- 品鉴预约\n\n导航保持 4 项，减少无关入口。',
    '### 视觉方向\n\n**色调** 低饱和葡萄园绿、陈年木色\n**字体** 衬线标题 + 无衬线正文\n**图片** 晨雾葡萄园、橡木桶、手写标签',
    '### 首页版式\n\n**首屏** 全幅葡萄园影像 + 一句酒庄宣言\n**第二屏** 年份时间轴\n**第三屏** 系列卡片，悬停显示风味\n**页脚** 预约入口常驻',
    '### 双语与预约\n\n中英文共用同一结构，切换不刷新页面。\n\n**预约字段**\n日期 · 人数 · 联系方式 · 备注\n\n提交后发送确认邮件。',
    '### 多端检查\n\n✓ 桌面 1440 / 1280\n✓ 平板 834\n✓ 手机 390\n\n主标题不折行，图片裁切保留葡萄园远景，预约按钮始终可见。',
  ],
  legal: [
    '### 条款与金额\n\n**合同总额** ¥ 480,000（示例）\n\n**付款** 30% 预付 · 40% 中期 · 30% 尾款\n**交付** 分两批，第 4 周与第 8 周\n**违约** 第 9.2 条',
    '### 付款与验收核对\n\n| 节点 | 触发条件 |\n|---|---|\n| 预付 | 签约后 5 日 |\n| 中期 | 首批验收 · **未写期限** |\n| 尾款 | “双方确认” · **条件模糊** |',
    '### 风险标记\n\n**高** 验收标准未量化（第 6 条）\n**中** 尾款触发条件模糊（第 7.3 条）\n**中** 违约金上限缺失（第 9.2 条）\n**低** 知识产权归属未写明',
    '### 修改建议\n\n**第 6 条** 补充验收清单与 5 个工作日反馈期限。\n\n**第 7.3 条** 尾款改为“终验通过后 10 日内支付”。\n\n以上建议需专业人员复核。',
  ],
  product: [
    '### 用户需求\n\n**痛点** 染烫后干枯、毛躁、梳理打结\n**期待** 即时顺滑 + 长期修护\n\n**竞品观察**\n多为免洗精油，冲洗型发膜选择较少。',
    '### 产品形态\n\n**冲洗型发膜** 每周 2–3 次\n**容量** 200 ml（待确认）\n**价格带** 中端（待确认）\n\n**卖点** 3 分钟顺滑、易冲洗',
    '### 配方研究方向\n\n- 保湿：多元醇体系\n- 调理：阳离子调理剂\n- 柔顺：植物油脂\n\n相容性与安全性需配方师评估。',
    '### 包装概念\n\n简洁圆罐，哑光白 + 一抹暖杏色。\n\n**正面** 品名 / 适用发质\n**背面** 用法与成分\n\n不写入未经验证的功效结论。',
    '### 打样与测试计划\n\n**第 1–2 周** 3 版小样\n**第 3–4 周** 稳定性 · 安全性\n**第 5 周** 30 人使用体验\n\n输出需求书与验证报告。',
  ],
  office: [
    '### 决策与行动项\n\n**已决定**\n- 新品素材周四定稿\n- 下周一上线预热\n\n**待执行** 6 项\n**待确认** 2 项',
    '### 任务分配\n\n| 任务 | 负责人 | 截止 |\n|---|---|---|\n| 素材审核 | 林舟 | 周三 |\n| 文案排期 | 陈禾 | 周四 |\n| 投放设置 | 待分配 | 周五 |',
    '### 任务依赖\n\n素材审核 → 文案排期 → 投放设置 → 上线\n\n**关键路径** 素材审核若延期，上线顺延。',
    '### 待你确认\n\n1. 预热预算是否维持 ¥ 20,000（示例）\n2. 上线时间：周一 10:00 或 20:00\n\n**跟进消息草稿** 已为 3 位负责人准备。',
  ],
  research: [
    '### 文献来源\n\n检索词：数字化能力 · 知识整合 · 创新绩效\n\n**初筛** 126 篇\n**精读** 18 篇\n\n每篇引用前核对出处。',
    '### 变量与量表\n\n| 变量 | 维度 | 题项 |\n|---|---|---|\n| 数字化能力 | 3 | 12 |\n| 知识整合 | 2 | 8 |\n| 创新绩效 | 2 | 6 |',
    '### 假设与模型\n\n**H1** 数字化能力 → 创新绩效（+）\n**H2** 数字化能力 → 知识整合（+）\n**H3** 知识整合的中介作用\n\n待数据验证。',
    '### 数据清洗\n\n有效样本 312 份（示例）\n\n- 缺失值：均值插补 4 处\n- 异常值：剔除 7 份\n- 反向题已重新编码',
    '### 检验结构\n\n1. 信度：Cronbach’s α\n2. 效度：CFA · AVE\n3. 直接效应\n4. 中介效应：Bootstrap 5000 次\n\n结果以表格呈现，结论待验证后撰写。',
  ],
};

const thinkingOpeners: Record<SceneKey, string> = {
  design: '用户要一整套春夏训练系列视觉。先确认品牌色与上架规格，再分场景组织素材，最后把成果铺到画布上便于整体确认。',
  video: '一支生活方式短片：需要先读懂产品素材，再定节奏与分镜，生成成片，最后补一份发布方案。',
  marketing: '7 天、两个平台、避免硬广。先找真实生活话题，再按平台差异化表达，最后排进日历。',
  website: '酒庄独立站：叙事优先，预约是核心转化。结构、视觉、开发、双语、多端检查依次推进。',
  legal: '合同审阅：付款与验收要放在一起核对，风险需分级，建议要对应到原条款。',
  product: '染烫后护理新品：从用户痛点出发，形态、配方方向、包装与测试计划要前后一致。',
  office: '会议记录整理：分清已决定和待决定，任务需要负责人、时间与依赖。',
  research: '研究框架：文献要可追溯，变量与量表对应清楚，假设与验证结论要区分开。',
};

function designScene(): ReplayScene {
  const s = homeScenes.design;
  const brief: ReplayNode = { id: 'design-brief', type: 'note', title: '春夏系列 · 视觉规范', x: 40, y: 40, w: 280, h: 330,
    params: { content: '### 为每一次运动而来。\n\n**品牌色**\n黑白、砂色与运动蓝。\n\n**场景**\n跑步、力量训练、日常穿搭。\n\n**交付**\n主视觉、商品图、详情页与推广场景。', color: 'slate' } };
  const nodes = [
    [brief],
    [image('design-made-to-move', '系列主视觉', 360, 40, 360, 'design/made-to-move.jpg', ['design-brief']),
      image('design-collection', '商品主图', 640, 40, 360, 'design/collection.jpg', ['design-brief'])],
    [image('design-city-duo', '跑步场景', 920, 40, 360, 'design/city-duo.jpg', ['design-made-to-move']),
      image('design-motion-bw', '运动姿态参考', 360, 440, 300, 'design/motion-bw.jpg', ['design-made-to-move']),
      image('design-community', '日常运动', 640, 440, 300, 'design/community.jpg', ['design-collection'])],
    [image('design-fabric-detail', '详情页 · 面料细节', 920, 440, 300, 'design/fabric-detail.jpg', ['design-collection'])],
  ];
  return { id: 'design', title: s.title, prompt: s.prompt, thinking: thinkingOpeners.design, response: s.response,
    steps: s.steps.map((title, i) => ({ title, thinking: s.messages[i], nodes: nodes[i] })) };
}

function videoScene(): ReplayScene {
  const steps: ReplayStep[] = [
    { title: '分析产品素材', thinking: '白色日常鞋，木质桌面，自然侧光。保留鞋型与材质纹理，作为成片的参考帧。',
      nodes: [{ id: 'video-source', type: 'image', title: '产品素材', x: 20, y: 100, w: 260, h: 165, params: { prompt: '自然光下的白色日常鞋，木质桌面。', size: '1536x1024' }, asset: 'film/source.jpg' }] },
    { title: '撰写创意与分镜', thinking: '主题定为「Make room for everyday」。三个镜头：完整产品缓推、鞋面细节、回到完整场景。',
      nodes: [{ id: 'video-plan', type: 'note', title: '创意与分镜', x: 340, y: 55, w: 280, h: 250, params: { content: '### Make room for everyday.\n\n从忙碌里，走回自己的节奏。\n\n**镜头 1**\n自然光下的完整产品，缓慢推进。\n\n**镜头 2**\n观察鞋面与材质细节。\n\n**镜头 3**\n舒展镜头，回到完整场景。', color: 'slate' } }] },
    { title: '生成 12 秒成片', thinking: '以产品素材为参考、分镜为提示，16:9，节奏放慢，保持产品形态一致。',
      nodes: [{ id: 'video-final', type: 'video', title: '日常鞋履 · 12 秒成片', x: 680, y: 90, w: 360, h: 215, params: { prompt: '自然光，缓慢推进，保持产品形态一致。', ratio: '16:9', duration: '10s' }, asset: 'film/everyday.mp4', from: ['video-source', 'video-plan'] }] },
    { title: '整理发布方案', thinking: '按一周节奏安排：先介绍产品，再放进生活场景，周五发布短片并收集反馈。',
      nodes: [{ id: 'video-copy', type: 'note', title: '发布方案', x: 680, y: 385, w: 360, h: 220, params: { content: '### 一周发布节奏\n\n**周一 · 产品介绍**\n产品细节与创意主题。\n\n**周三 · 场景内容**\n将产品放进日常生活。\n\n**周五 · 短片发布**\n汇总反馈，整理下一轮内容。', color: 'slate' }, from: ['video-final'] }] },
  ];
  return { id: 'video', title: '日常鞋履 · 发布短片', prompt: '用这张产品图做一支生活方式短片。自然光，节奏慢一点，同时整理发布方案。',
    thinking: thinkingOpeners.video, response: '短片以产品近景开场，缓慢推进到鞋面细节，再回到完整场景。字幕和镜头节奏已配好，发布方案也一并整理。', steps };
}

function noteScene(id: Exclude<SceneKey, 'video' | 'design'>): ReplayScene {
  const s = homeScenes[id];
  return { id, title: s.title, prompt: s.prompt, thinking: thinkingOpeners[id], response: s.response,
    steps: s.steps.map((title, i) => ({ title, thinking: s.messages[i],
      nodes: [note(`${id}-note-${i}`, title, i, deliverables[id][i] ?? `### ${title}\n\n${s.messages[i]}`, i ? [`${id}-note-${i - 1}`] : undefined)] })) };
}

export const replayScenes: Record<string, ReplayScene> = Object.fromEntries((Object.keys(homeScenes) as SceneKey[]).map(id =>
  [id, id === 'design' ? designScene() : id === 'video' ? videoScene() : noteScene(id)]));

export function finalText(scene: ReplayScene) {
  return `${scene.response}\n\n${scene.steps.map(step => `**${step.title}**\n${step.thinking}`).join('\n\n')}\n\n相关内容已放在右侧画布，可以打开节点继续查看。`;
}

export const offScriptReply = '这里是官网上的工作台体验，内容为预先准备的示例。\n\n要让 Agent 真正处理你的任务，请进入 REIZO 工作台。';
