import { createHash } from 'node:crypto';
import { generateImage, tool } from 'ai';
import { z } from 'zod';
import { defaultNodeBox } from '../../../shared/canvas';
import { editNodeTitle, isLocalEdit, type ImageEditKind } from '../../../shared/canvasImageEdit';
import { getProviderPreset } from '../../../shared/providers';
import { classifyMediaError } from '../canvas/mediaError';
import { startImageNode } from '../canvas/imageExecutor';
import { stageCanvasAssets } from '../canvas/assets';
import { CanvasCommandError, createCanvasApplication } from '../canvas/application';
import { canvasWorkSignal, canvasWorkStopped } from '../canvas/workLifecycle';
import { nodeJobsFor, NodeJobsClosedError, type NodeJobSubmission } from '../canvas/nodeJobs';
import type { CanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { createOpenAiProvider } from './provider/openai';

const MODEL_EDIT_KINDS = [
  'multiAngle',
  'inpaint',
  'erase',
  'relight',
  'outpaint',
  'enhance',
  'matting',
] as const satisfies readonly ImageEditKind[];

function toolOperation(toolCallId: string | undefined, kind: string, phase: string): string | undefined {
  return toolCallId ? `${kind}:${phase}:${createHash('sha256').update(toolCallId).digest('hex')}` : undefined;
}

function assertImageWork(store: CanvasStore): void {
  if (canvasWorkStopped(store) || !nodeJobsFor(store).isAccepting()) throw new NodeJobsClosedError();
}

async function awaitImageJob(store: CanvasStore, submission: NodeJobSubmission) {
  const signal = canvasWorkSignal(store);
  let onStopped!: () => void;
  const stopped = new Promise<void>((resolve) => { onStopped = resolve; });
  signal.addEventListener('abort', onStopped, { once: true });
  try {
    if (!signal.aborted) await Promise.race([submission.completion, stopped]);
  } finally { signal.removeEventListener('abort', onStopped); }
  // Host shutdown may have closed SQLite before this continuation resumes.
  if (canvasWorkStopped(store) || !nodeJobsFor(store).isAccepting()) return null;
  return store.jobs.get(submission.job.id);
}

export function createImageTools(options: {
  settingsStore: SettingsStore;
  dataRoot: string;
  sessionId?: string;
  canvasStore?: CanvasStore;
}) {
  const { settingsStore, dataRoot, sessionId, canvasStore } = options;
  const canvasApp = canvasStore ? createCanvasApplication(canvasStore) : undefined;

  return {
    generate_image: tool({
      description:
        '在当前对话中直接生成并展示图片（支持插画、海报、头像、设计草图等各种文生图需求）。当用户表示“生图”、“画一张图”、“生成海报/插画”时，必须调用此工具直接在对话中生成，不要另外调用画布操作或打开画布界面。',
      inputSchema: z.object({
        prompt: z
          .string()
          .describe('详细的生图提示词，建议包含主体特征、艺术风格、色彩色调、光影效果、画面细节等描述'),
        size: z
          .enum(['1024x1024', '1024x1792', '1792x1024', '512x512'])
          .optional()
          .default('1024x1024')
          .describe('图片分辨率尺寸，默认为 1024x1024'),
        model: z
          .string()
          .optional()
          .describe('生图模型，默认自动使用 gpt-image-2（Reizo网关）或 dall-e-3（OpenAI官方直连）'),
      }),
      execute: async ({ prompt, size, model }, context) => {
        const cleanPrompt = prompt.trim();
        if (!cleanPrompt) {
          return { ok: false, error: '生图提示词不能为空' };
        }

        if (canvasStore && sessionId && canvasApp) {
          try {
            assertImageWork(canvasStore);
            const canvas = canvasStore.ensureCanvas(sessionId);
            const created = canvasApp.batch(canvas.id, { kind: 'inline_image', prompt: cleanPrompt, size: size ?? '1024x1024', model }, () => {
              const index = canvasStore.getSnapshot(canvas.id)?.nodes.length ?? 0;
              const box = defaultNodeBox('image');
              return canvasApp.addNode(canvas.id, {
                type: 'image', x: 40 + (index % 3) * (box.w + 60), y: 60 + Math.floor(index / 3) * (box.h + 60),
                w: box.w, h: box.h, title: '对话生成图片',
                params: { prompt: cleanPrompt, size: size ?? '1024x1024', ...(model ? { model } : {}), origin: 'chat' },
              }).node;
            }, toolOperation(context?.toolCallId, 'generate_image', 'node'));
            const accepted = startImageNode({ canvasStore, settingsStore, dataRoot, canvasId: canvas.id, node: created,
              operationId: toolOperation(context?.toolCallId, 'generate_image', 'job'), signal: context?.abortSignal });
            const job = await awaitImageJob(canvasStore, accepted);
            if (!job) return { ok: false, jobId: accepted.job.id, error: '应用正在退出，图片任务已中断。' };
            if (job.status !== 'succeeded') return { ok: false, jobId: job.id, error: job.error ?? (job.status === 'cancelled' ? '图片任务已停止。' : '图片生成未完成，请重试。') };
            const output = job.result as { assets?: string[]; resultSet?: Array<{ asset: string; prompt?: string; model?: string }> } | undefined;
            const image = output?.resultSet?.[0];
            const asset = image?.asset ?? output?.assets?.[0];
            if (!asset) return { ok: false, jobId: job.id, error: '生图接口未返回有效图片数据' };
            const captured = (job.input.node as { params?: { prompt?: string; size?: string } } | undefined)?.params;
            const imageSize = captured?.size ?? '1024x1024';
            return { ok: true, jobId: job.id, imageUrl: `/api/canvas/assets/${asset}`, prompt: image?.prompt ?? captured?.prompt ?? cleanPrompt,
              size: imageSize, model: image?.model ?? job.model ?? model, summary: `已在对话中生成图片 (${imageSize})` };
          } catch (error) {
            const classified = classifyMediaError(error);
            return { ok: false, error: error instanceof CanvasCommandError || error instanceof NodeJobsClosedError ? error.message : classified.message };
          }
        }

        const settings = await settingsStore.get();
        const activeProviderId = settings.activeProviderId;
        const activeStored = settings.providers[activeProviderId];
        const reizoStored = settings.providers['reizo'];
        const openaiStored = settings.providers['openai'];

        let targetProviderId = activeProviderId;
        let apiKey = activeStored?.apiKey;
        let baseUrl = activeStored?.baseUrl;

        // 若当前激活的 provider 未配置 key，优先尝试默认的 reizo 或 openai
        if (!apiKey && reizoStored?.apiKey) {
          targetProviderId = 'reizo';
          apiKey = reizoStored.apiKey;
          baseUrl = reizoStored.baseUrl;
        } else if (!apiKey && openaiStored?.apiKey) {
          targetProviderId = 'openai';
          apiKey = openaiStored.apiKey;
          baseUrl = openaiStored.baseUrl;
        }

        const preset = getProviderPreset(targetProviderId);
        const effectiveBaseUrl = baseUrl || preset?.baseUrl || 'https://v2api.top/v1';

        if (!apiKey) {
          return {
            ok: false,
            error: '请先在系统设置中配置 API Key（Reizo 预设已支持 gpt-image-2 等全模型）。',
          };
        }

        const isOfficial = !effectiveBaseUrl || effectiveBaseUrl.includes('api.openai.com');
        const effectiveModel = model || (isOfficial ? 'dall-e-3' : 'gpt-image-2');

        try {
          const provider = createOpenAiProvider({ apiKey, baseUrl: effectiveBaseUrl, retryTransport: false });
          const result = await generateImage({
            model: provider.image(effectiveModel),
            prompt: cleanPrompt,
            size: size ?? '1024x1024',
            maxRetries: 0,
            abortSignal: context?.abortSignal,
          });

          if (!result.images || result.images.length === 0) {
            return { ok: false, error: '生图接口未返回有效图片数据' };
          }

          const img = result.images[0];
          if (!img.uint8Array.byteLength) return { ok: false, error: '生图接口未返回有效图片数据' };
          const ext = img.mediaType?.includes('jpeg') ? 'jpg' : 'png';
          const filename = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
          const staged = await stageCanvasAssets(dataRoot, 'chat', [{ name: filename, bytes: img.uint8Array,
            mimeType: ext === 'jpg' ? 'image/jpeg' : 'image/png', kind: 'image' }], context?.abortSignal);
          try {
            staged.keep();
            return {
              ok: true,
              imageUrl: `/api/canvas/assets/${staged.files[0].path}`,
              prompt: cleanPrompt,
              size: size ?? '1024x1024',
              model: effectiveModel,
              summary: `已在对话中生成图片 (${size ?? '1024x1024'})`,
            };
          } finally { await staged.discard(); }
        } catch (err) {
          const classified = classifyMediaError(err);
          return {
            ok: false,
            error: classified.message,
            rawError: classified.raw !== classified.message ? classified.raw : undefined,
          };
        }
      },
    }),

    canvas_edit_image: tool({
      description:
        '在画布上从已有图片节点派生一次模型编辑（打光、抠图、重绘、多角度、扩图、擦除、增强）。会新建一个连线的 image 节点并开始生成。当用户说「把这个节点打暖一点」「抠掉背景」「换个角度」时使用。裁剪/标注/切分等本地操作请让用户在画布工具条上手动完成。',
      inputSchema: z.object({
        nodeId: z.string().describe('源图片（或视频）节点 id'),
        kind: z
          .enum(MODEL_EDIT_KINDS)
          .describe('编辑类型：relight 打光 / matting 抠图 / inpaint 重绘 / erase 擦除 / multiAngle 多角度 / outpaint 扩图 / enhance 增强'),
        instruction: z.string().optional().describe('重绘等操作的自然语言描述'),
        params: z
          .object({
            rotateDeg: z.number().optional(),
            tiltDeg: z.number().optional(),
            zoom: z.number().optional(),
            wideAngle: z.boolean().optional(),
            brightness: z.number().optional(),
            colorTempK: z.number().optional(),
            lightDir: z.enum(['left', 'top', 'right', 'front', 'bottom', 'back']).optional(),
            rimLight: z.boolean().optional(),
            pad: z
              .object({
                left: z.number(),
                right: z.number(),
                top: z.number(),
                bottom: z.number(),
              })
              .optional(),
            scale: z.union([z.literal(2), z.literal(4)]).optional(),
            strength: z.number().optional(),
          })
          .optional(),
      }),
      execute: async ({ nodeId, kind, instruction, params }, context) => {
        if (!canvasStore || !sessionId || !canvasApp) {
          return { ok: false, error: '当前会话没有画布' };
        }
        if (isLocalEdit(kind)) {
          return { ok: false, error: '该编辑需要在画布上手工完成' };
        }
        try {
          assertImageWork(canvasStore);
          const canvas = canvasStore.ensureCanvas(sessionId);
          const node = canvasApp.batch(canvas.id, { kind: 'canvas_edit_image', nodeId, editKind: kind, instruction, params }, () => {
            const src = canvasStore.getNode(canvas.id, nodeId);
            if (!src) throw new CanvasCommandError(`找不到节点 ${nodeId}`, 404);
            if ((src.output?.assets?.length ?? 0) === 0) throw new CanvasCommandError('源节点还没有生成图片');
            const srcParams = (src.params || {}) as { size?: string; model?: string };
            const box = defaultNodeBox('image');
            const created = canvasApp.addNode(canvas.id, { type: 'image', x: Math.round(src.x + src.w + 80), y: Math.round(src.y),
              w: box.w, h: box.h, title: editNodeTitle(kind), params: { prompt: '', size: srcParams.size ?? '1024x1024',
                model: srcParams.model, edit: { kind, sourceNodeId: src.id, instruction, params } } }).node;
            const edge = canvasApp.addEdge(canvas.id, { sourceId: src.id, targetId: created.id, sourceHandle: 'image_out', targetHandle: 'edit_src' });
            if (!edge.edge) throw new CanvasCommandError(`无法连接编辑源图：${edge.error ?? 'unknown'}`);
            return created;
          }, toolOperation(context?.toolCallId, 'canvas_edit_image', 'node'));
          const accepted = startImageNode({ canvasStore, settingsStore, dataRoot, canvasId: canvas.id, node,
            operationId: toolOperation(context?.toolCallId, 'canvas_edit_image', 'job'), signal: context?.abortSignal });
          return { ok: true, id: node.id, jobId: accepted.job.id, kind, sourceNodeId: nodeId, status: accepted.job.status,
            summary: `已派生「${editNodeTitle(kind)}」节点并开始生成` };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
  };
}
