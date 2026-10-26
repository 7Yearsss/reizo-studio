import Bfl from '@lobehub/icons/es/Bfl/components/Mono';
import ChatGLM from '@lobehub/icons/es/ChatGLM/components/Mono';
import Claude from '@lobehub/icons/es/Claude/components/Mono';
import DeepSeek from '@lobehub/icons/es/DeepSeek/components/Mono';
import Gemini from '@lobehub/icons/es/Gemini/components/Color';
import Grok from '@lobehub/icons/es/Grok/components/Mono';
import Kimi from '@lobehub/icons/es/Kimi/components/Mono';
import Kling from '@lobehub/icons/es/Kling/components/Mono';
import Luma from '@lobehub/icons/es/Luma/components/Mono';
import Meta from '@lobehub/icons/es/Meta/components/Mono';
import Midjourney from '@lobehub/icons/es/Midjourney/components/Mono';
import Mistral from '@lobehub/icons/es/Mistral/components/Mono';
import OpenAI from '@lobehub/icons/es/OpenAI/components/Mono';
import OpenRouter from '@lobehub/icons/es/OpenRouter/components/Mono';
import SiliconCloud from '@lobehub/icons/es/SiliconCloud/components/Mono';
import Qwen from '@lobehub/icons/es/Qwen/components/Mono';
import Stability from '@lobehub/icons/es/Stability/components/Mono';
import type { ComponentType } from 'react';

export type VendorIconComponent = ComponentType<{ size: number; className?: string }>;

/**
 * Vendor logo for a model, keyed by the domains `modelVendorDomain()` emits.
 * Use standalone SVGs so a 16px logo does not import the full avatar/UI library.
 * Callers fall back to favicon/`Bot` when a domain isn't listed here.
 */
export const MODEL_VENDOR_ICONS: Record<string, VendorIconComponent> = {
  'openai.com': OpenAI,
  'openrouter.ai': OpenRouter,
  'siliconflow.cn': SiliconCloud,
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
