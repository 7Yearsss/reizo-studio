import {
  Bfl,
  ChatGLM,
  Claude,
  DeepSeek,
  Gemini,
  Grok,
  Kimi,
  Kling,
  Luma,
  Meta,
  Midjourney,
  Mistral,
  OpenAI,
  Qwen,
  Stability,
} from '@lobehub/icons';
import type { IconType } from '@lobehub/icons';

/**
 * Vendor logo for a model, keyed by the domains `modelVendorDomain()` emits.
 * Callers fall back to favicon/`Bot` when a domain isn't listed here.
 */
export const MODEL_VENDOR_ICONS: Record<string, IconType> = {
  'openai.com': OpenAI,
  'x.ai': Grok,
  'anthropic.com': Claude,
  'deepmind.google': Gemini,
  'deepseek.com': DeepSeek,
  'moonshot.cn': Kimi,
  'bigmodel.cn': ChatGLM,
  'www.aliyun.com': Qwen,
  'mistral.ai': Mistral,
  'bfl.ai': Bfl,
  'www.midjourney.com': Midjourney,
  'klingai.com': Kling,
  'lumalabs.ai': Luma,
  'stability.ai': Stability,
  'www.llama.com': Meta,
};
