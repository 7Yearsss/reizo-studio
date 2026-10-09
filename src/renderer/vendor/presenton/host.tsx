/** Reizo adapters for the Apache-2.0 Presenton editor; no Presenton service dependency. */
import type { ImgHTMLAttributes } from 'react';
import { toast } from '../../lib/toast';

export const notify = { ...toast, warning: toast.info };
export function resolveBackendAssetUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  return /^(data:image\/|https?:\/\/|blob:)/i.test(value) ? value : '';
}
export function resolveBackendAssetSource(value: unknown): string {
  if (typeof value === 'string') return resolveBackendAssetUrl(value);
  if (!value || typeof value !== 'object') return '';
  const asset = value as Record<string, unknown>;
  return resolveBackendAssetUrl(asset.url ?? asset.path ?? asset.data);
}
export async function readPresentationImage(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type) || file.size > 5 * 1024 * 1024) throw new Error('请选择 5 MB 以内的 PNG、JPEG、WebP、GIF 或 SVG 图片');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
export const ImagesApi = { async uploadImage(file: File) { return { url: await readPresentationImage(file) }; } };
export function Image({ fill, unoptimized: _unoptimized, priority: _priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean; priority?: boolean }) {
  return <img {...props} style={{ ...(fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } as const : {}), ...props.style }} />;
}
