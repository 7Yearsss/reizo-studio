import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateImage, tool } from 'ai';
import { z } from 'zod';
import { getProviderPreset } from '../../../shared/providers';
import { classifyMediaError } from '../canvas/mediaError';
import type { SettingsStore } from '../storage/settingsStore';
import { createOpenAiProvider } from './provider/openai';

export function createImageTools(options: {
  settingsStore: SettingsStore;
  dataRoot: string;
}) {
  const { settingsStore, dataRoot } = options;

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
  };
}
