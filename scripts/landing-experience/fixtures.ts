import type { Session } from '../../src/shared/chat';
import type { CanvasNode, CanvasSnapshot } from '../../src/shared/canvas';
import type { PublicSettings } from '../../src/shared/settings';
import { replayScenes } from './replay';

const date = '2026-10-05T08:00:00.000Z';
const message = (id: string, role: 'user' | 'assistant', content: string) => ({ id, role, content, createdAt: date,
  ...(role === 'assistant' ? { turnOutcome: 'completed' as const } : {}) });

export function makeFixtures() {
  // Completed samples used by the older LandingPage ExperienceSurface (project=film / commerce).
  const sessions: Session[] = [
    { id: 'film', title: '日常鞋履 · 发布短片', createdAt: date, updatedAt: date, workspacePath: null, projectId: null, lastTurnOutcome: 'completed',
      messages: [
        message('film-u', 'user', '用这张产品图做一支生活方式短片。自然光，节奏慢一点，同时整理发布方案。'),
        message('film-a', 'assistant', '已把素材、创意方向和成片放到右侧画布。\n\n短片以产品近景开场，缓慢推进到鞋面细节，再回到完整场景。字幕和镜头节奏已配好。\n\n你可以在画布上播放成片，也可以打开发布方案，继续调整。'),
      ] },
    { id: 'commerce', title: '毛球修剪器 · 电商套图', createdAt: date, updatedAt: date, workspacePath: null, projectId: null, lastTurnOutcome: 'completed',
      messages: [message('commerce-u', 'user', '根据产品参考图，整理一套电商图片：白底主图、细节图和卖点图。保留蓝色按钮和透明集屑杯。'),
        message('commerce-a', 'assistant', '已整理好白底主图、产品细节和卖点图。\n\n蓝色按钮和透明集屑杯已保留。图片与商品文案放在右侧画布。') ] },
  ];
  function node(canvasId: string, id: string, type: CanvasNode['type'], title: string, x: number, y: number, w: number, h: number,
    params: CanvasNode['params'], asset?: string): CanvasNode {
    return { id, canvasId, type, title, x, y, w, h, params, paramsHash: null, runState: asset ? 'done' : 'idle',
      output: asset ? { assets: [asset] } : null, updatedAt: date };
  }
  function canvas(id: string, nodes: CanvasNode[], pairs: [string, string][]): CanvasSnapshot {
    return { canvas: { id, sessionId: id, liveRevision: 1, createdAt: date, updatedAt: date }, nodes,
      edges: pairs.map(([sourceId, targetId], i) => {
        const source = nodes.find(node => node.id === sourceId)!;
        const target = nodes.find(node => node.id === targetId)!;
        return { id: `${id}-edge-${i}`, canvasId: id, sourceId, targetId,
          sourceHandle: source.type === 'image' ? 'image_out' : 'prompt_out',
          targetHandle: target.type === 'note' ? 'text_in' : source.type === 'image' ? 'reference' : 'prompt' };
      }) };
  }
  const canvases: Record<string, CanvasSnapshot> = {
    film: canvas('film', [
      node('film', 'film-source', 'image', '产品素材', 20, 100, 260, 165, { prompt: '自然光下的白色日常鞋，木质桌面。', size: '1536x1024' }, 'film/source.jpg'),
      node('film', 'film-plan', 'note', '创意与分镜', 340, 55, 280, 250, { content: '### Make room for everyday.\n\n从忙碌里，走回自己的节奏。\n\n**镜头 1**\n自然光下的完整产品，缓慢推进。\n\n**镜头 2**\n观察鞋面与材质细节。\n\n**镜头 3**\n舒展镜头，回到完整场景。', color: 'slate' }),
      node('film', 'film-final', 'video', '日常鞋履 · 12 秒成片', 680, 90, 360, 215, { prompt: '自然光，缓慢推进，保持产品形态一致。', ratio: '16:9', duration: '10s' }, 'film/everyday.mp4'),
      node('film', 'film-copy', 'note', '发布方案', 680, 385, 360, 220, { content: '### 一周发布节奏\n\n**周一 · 产品介绍**\n产品细节与创意主题。\n\n**周三 · 场景内容**\n将产品放进日常生活。\n\n**周五 · 短片发布**\n汇总反馈，整理下一轮内容。', color: 'slate' }),
    ], [['film-source', 'film-final'], ['film-plan', 'film-final'], ['film-final', 'film-copy']]),
    commerce: canvas('commerce', [
      node('commerce', 'commerce-ref', 'image', '产品参考', 20, 110, 240, 240, { prompt: '白色毛球修剪器，蓝色按钮，透明集屑杯。', size: '1024x1024' }, 'commerce/main.jpg'),
      node('commerce', 'commerce-main', 'image', '白底主图', 340, 20, 240, 240, { prompt: '纯白背景，保留产品外形，柔和光线。', size: '1024x1024' }, 'commerce/main.jpg'),
      node('commerce', 'commerce-detail', 'image', '产品细节', 660, 20, 240, 240, { prompt: '刀网、按钮与充电接口的产品细节组图。', size: '1024x1024' }, 'commerce/detail.jpg'),
      node('commerce', 'commerce-features', 'image', '功能卖点', 660, 355, 182, 380, { prompt: '简洁的商品卖点图，搭配功能说明。', size: '1024x1024' }, 'commerce/features.jpg'),
      node('commerce', 'commerce-copy', 'note', '商品文案', 340, 355, 255, 255, { content: '### 便携毛球修剪器\n\n让旧衣物恢复整洁。\n\n- USB 充电\n- 蜂窝刀网\n- 透明集屑杯\n\n主图与详情页统一使用白色背景。', color: 'slate' }),
    ], [['commerce-ref', 'commerce-main'], ['commerce-ref', 'commerce-detail'], ['commerce-detail', 'commerce-features']]),
  };
  const settings: PublicSettings = { appearance: 'light', activeProviderId: 'reizo', workspacePath: null, permissionMode: 'ask',
    busyEnter: 'queue', computerUse: false,
    autoApplyHarnessLessons: false, mediaModels: {}, directorSessions: {}, reasoningEffort: 'low', providers: [
      { id: 'reizo', name: 'REIZO', tag: '多模型', hasKey: false, model: 'gpt-6-astra', baseUrl: '', websiteUrl: 'https://reizo-ai.com',
        allowCustomBaseUrl: false, description: '官网界面体验', models: [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }, { id: 'gpt-6-astra', name: 'GPT-6 Astra' }] },
    ] };
  // Homepage scenes start empty: the conversation and canvas are played back by transport.ts.
  const homepageSessions: Session[] = Object.values(replayScenes).map((scene): Session => ({ id: scene.id, title: scene.title,
    createdAt: date, updatedAt: date, workspacePath: null, projectId: null, lastTurnOutcome: null, messages: [] }));
  for (const scene of Object.values(replayScenes)) canvases[scene.id] = canvas(scene.id, [], []);
  return { sessions: [...homepageSessions, ...sessions], canvases, settings };
}
