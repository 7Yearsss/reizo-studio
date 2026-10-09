/** Reizo local-image picker replacing Presenton's hosted stock/generation services. */
import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { readPresentationImage } from '../host';

export function ImagePickerModal({ currentImage, open, onClose, onSelect }: {
  currentImage?: string | null; initialPrompt?: string | null; targetSize?: { width: number; height: number } | null;
  open: boolean; onClose(): void; onSelect(url: string, prompt?: string): void;
}) {
  const input = useRef<HTMLInputElement>(null); const [error, setError] = useState('');
  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}><DialogContent><DialogHeader><DialogTitle>替换图片</DialogTitle><DialogDescription>导入本地图片，图片会随演示稿保存。</DialogDescription></DialogHeader>
    {currentImage && <img src={currentImage} alt="当前图片" className="max-h-64 w-full object-contain" />}
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readPresentationImage(file).then((url) => { onSelect(url); onClose(); }, (cause) => setError(String(cause))); }} />
    {error && <p role="alert">{error}</p>}<Button onClick={() => input.current?.click()}>选择图片</Button>
  </DialogContent></Dialog>;
}
