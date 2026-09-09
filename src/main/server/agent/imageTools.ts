import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateImage, tool } from 'ai';
import { z } from 'zod';
import { defaultNodeBox } from '../../../shared/canvas';
import { editNodeTitle, isLocalEdit, type ImageEditKind } from '../../../shared/canvasImageEdit';
import { getProviderPreset } from '../../../shared/providers';
import { classifyMediaError } from '../canvas/mediaError';
import { getCanvasChannel } from '../canvas/channel';
import { runImageNode } from '../canvas/imageExecutor';
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

export function createImageTools(options: {
  settingsStore: SettingsStore;
  dataRoot: string;
  sessionId?: string;
  canvasStore?: CanvasStore;
}) {
  const { settingsStore, dataRoot, sessionId, canvasStore } = options;

  return {
    generate_image: tool({
      description:
        '在当前对话中直接生成并展示图片（支持插画、海报、头像、设计草图等各种文生图需求）。当用户表示“生图”、“画一张图”、“生成海报/插画”时，必须调用此工具直接在对话中生成，严禁去操作或打开画布。',
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
      execute: async ({ prompt, size, model }) => {
        const cleanPrompt = prompt.trim();
        if (!cleanPrompt) {
          return { ok: false, error: '生图提示词不能为空' };
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
          const provider = createOpenAiProvider({ apiKey, baseUrl: effectiveBaseUrl });
          const result = await generateImage({
            model: provider.image(effectiveModel),
            prompt: cleanPrompt,
            size: size ?? '1024x1024',
          });

          if (!result.images || result.images.length === 0) {
            return { ok: false, error: '生图接口未返回有效图片数据' };
          }

          const img = result.images[0]!;
          const ext = img.mediaType?.includes('jpeg') ? 'jpg' : 'png';
          const filename = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
          const dir = path.join(dataRoot, 'canvas', 'chat');
          await mkdir(dir, { recursive: true });
          await writeFile(path.join(dir, filename), Buffer.from(img.uint8Array));

          const relUrl = `/api/canvas/assets/chat/${filename}`;

          return {
            ok: true,
            imageUrl: relUrl,
            prompt: cleanPrompt,
            size: size ?? '1024x1024',
            model: effectiveModel,
            summary: `已在对话中生成图片 (${size ?? '1024x1024'})`,
          };
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
      execute: async ({ nodeId, kind, instruction, params }) => {
        if (!canvasStore || !sessionId) {
          return { ok: false, error: '当前会话没有画布' };
        }
        if (isLocalEdit(kind)) {
          return { ok: false, error: '该编辑需要在画布上手工完成' };
        }
        const canvas = canvasStore.ensureCanvas(sessionId);
        const src = canvasStore.getNode(canvas.id, nodeId);
        if (!src) return { ok: false, error: `找不到节点 ${nodeId}` };
        if ((src.output?.assets?.length ?? 0) === 0) {
          return { ok: false, error: '源节点还没有生成图片' };
        }
        const srcParams = (src.params || {}) as { size?: '1024x1024' | '1024x1536' | '1536x1024'; model?: string };
        const box = defaultNodeBox('image');
        const { rev, node } = canvasStore.addNode(canvas.id, {
          type: 'image',
          x: Math.round(src.x + src.w + 80),
          y: Math.round(src.y),
          w: box.w,
          h: box.h,
          title: editNodeTitle(kind),
          params: {
            prompt: '',
            size: srcParams.size ?? '1024x1024',
            model: srcParams.model,
            edit: { kind, sourceNodeId: src.id, instruction, params },
          },
        });
        const channel = getCanvasChannel(canvas.id);
        channel.broadcast(rev, { type: 'node_added', node });
        const edgeRes = canvasStore.addEdge(canvas.id, {
          sourceId: src.id,
          targetId: node.id,
          sourceHandle: 'image_out',
          targetHandle: 'edit_src',
        });
        if (edgeRes.edge && edgeRes.rev != null) {
          channel.broadcast(edgeRes.rev, { type: 'edge_added', edge: edgeRes.edge });
        }
        void runImageNode({
          canvasStore,
          settingsStore,
          dataRoot,
          canvasId: canvas.id,
          node,
        });
        return {
          ok: true,
          id: node.id,
          kind,
          sourceNodeId: src.id,
          status: 'running',
          summary: `已派生「${editNodeTitle(kind)}」节点并开始生成`,
        };
      },
    }),
  };
}
