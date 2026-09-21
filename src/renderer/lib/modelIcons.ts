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
import type { ComponentType } from 'react';

export type VendorIconComponent = ComponentType<{ size: number; className?: string }>;

/**
 * Vendor logo for a model, keyed by the domains `modelVendorDomain()` emits.
 * Each entry is the brand-colored `Avatar` variant (colored tile + glyph).
 * Callers fall back to favicon/`Bot` when a domain isn't listed here.
 */
export const MODEL_VENDOR_ICONS: Record<string, VendorIconComponent> = {
  'openai.com': OpenAI.Avatar,
  'x.ai': Grok.Avatar,
  'anthropic.com': Claude.Avatar,
  'deepmind.google': Gemini.Avatar,
  'deepseek.com': DeepSeek.Avatar,
  'moonshot.cn': Kimi.Avatar,
  'bigmodel.cn': ChatGLM.Avatar,
  'www.aliyun.com': Qwen.Avatar,
  'mistral.ai': Mistral.Avatar,
  'bfl.ai': Bfl.Avatar,
  'www.midjourney.com': Midjourney.Avatar,
  'klingai.com': Kling.Avatar,
  'lumalabs.ai': Luma.Avatar,
  'stability.ai': Stability.Avatar,
  'www.llama.com': Meta.Avatar,
};
