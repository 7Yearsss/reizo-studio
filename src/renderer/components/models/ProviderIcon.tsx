import { ServerCog } from 'lucide-react';
import logoUrl from '../../assets/logo.png';
import ModelIcon from './ModelIcon';
import { cn } from '../../lib/cn';

const domains: Record<string, string> = {
  openai: 'openai.com', deepseek: 'deepseek.com', moonshot: 'moonshot.cn',
  zhipu: 'bigmodel.cn', siliconflow: 'siliconflow.cn', openrouter: 'openrouter.ai', gemini: 'deepmind.google',
};

/** Provider identity stays independent of whichever vendor's model it currently serves. */
export default function ProviderIcon({ providerId, className }: { providerId: string; className?: string }) {
  if (providerId === 'reizo' || providerId === 'reizo-account') {
    return <img src={logoUrl} alt="" draggable={false} className={cn('size-5 shrink-0 select-none object-contain', className)} />;
  }
  if (domains[providerId]) return <ModelIcon domain={domains[providerId]} className={cn('size-5', className)} />;
  return <ServerCog aria-hidden className={cn('size-5 shrink-0 text-ink-muted', className)} />;
}
