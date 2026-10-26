import { isIP } from 'node:net';

/** Payment pages never receive the desktop preload, credentials or local-network access. */
export function isCashierUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      host.includes('.') && !isIP(host.replace(/^\[|\]$/g, '')) &&
      !['localhost', 'local', 'internal', 'lan', 'home', 'arpa'].some(suffix => host === suffix || host.endsWith(`.${suffix}`));
  } catch { return false; }
}

export interface CashierPurchase {
  url: string;
  params: Record<string, string>;
  reference: string;
  amount: number;
  currency: string;
}
