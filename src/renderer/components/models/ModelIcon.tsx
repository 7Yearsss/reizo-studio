import { Bot } from 'lucide-react';
import { MODEL_VENDOR_ICONS } from '../../lib/modelIcons';
import { useFavicon } from '../../lib/hooks/use-favicon';
import { cn } from '../../lib/cn';

export default function ModelIcon({ domain, className }: { domain?: string; className?: string }) {
  const VendorIcon = domain ? MODEL_VENDOR_ICONS[domain] : undefined;
  const url = domain && !VendorIcon ? (/^https?:\/\//.test(domain) ? domain : `https://${domain}`) : undefined;
  const { src, ref } = useFavicon(url);
  if (VendorIcon) return <VendorIcon size={16} className={cn('shrink-0', className)} />;
  if (!src) return <Bot size={16} className={cn('shrink-0 text-ink-muted', className)} />;
  return <img ref={ref} src={src} alt="" width={16} height={16} referrerPolicy="no-referrer" className={cn('size-4 shrink-0 rounded-sm object-contain', className)} />;
}
