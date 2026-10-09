import { useRef, useState } from 'react';
import { Check, LoaderCircle, Pencil, X } from 'lucide-react';
import type { CanvasAssetSummary } from '../../../shared/canvasAssets';
import { updateCanvasAssetMetadata } from '../../api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../ui/field';
import { Alert, AlertDescription } from '../ui/alert';
import { Tooltip } from '../ui/Tooltip';

export default function AssetMetadataEditor({ asset, onSaved }: { asset: CanvasAssetSummary; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => { if (busy) return; setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()); };
  if (!open) return <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"><Tooltip content="整理名称、目录和标签"><Button ref={triggerRef} type="button" variant="ghost" size="icon-xs" aria-label={`整理${asset.label}`} aria-expanded={false} onClick={() => { setError(''); setOpen(true); }}><Pencil /></Button></Tooltip></div>;
  return <form aria-label={`整理${asset.label}`} aria-busy={busy} className="mt-2 flex flex-col gap-3 rounded-lg bg-paper p-3" onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }} onSubmit={(event) => {
    event.preventDefault(); if (busy) return;
    const values = new FormData(event.currentTarget);
    setBusy(true); setError('');
    void updateCanvasAssetMetadata(asset.id, { name: String(values.get('name')).trim(), folder: String(values.get('folder')).trim(),
      tags: String(values.get('tags')).split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })
      .then(() => { setOpen(false); onSaved(); requestAnimationFrame(() => triggerRef.current?.focus()); }).catch((error) => setError(error instanceof Error ? error.message : '保存失败'))
      .finally(() => setBusy(false));
  }}>
    <FieldGroup className="gap-2">
      <Field data-disabled={busy} className="gap-1.5"><FieldLabel htmlFor={`${asset.id}-name`}>名称</FieldLabel><Input id={`${asset.id}-name`} name="name" defaultValue={asset.name || asset.label} maxLength={160} required autoFocus disabled={busy} /></Field>
      <Field data-disabled={busy} className="gap-1.5"><FieldLabel htmlFor={`${asset.id}-folder`}>目录</FieldLabel><Input id={`${asset.id}-folder`} name="folder" defaultValue={asset.folder} maxLength={160} placeholder="例如：品牌 / 产品图" disabled={busy} /></Field>
      <Field data-disabled={busy} className="gap-1.5"><FieldLabel htmlFor={`${asset.id}-tags`}>标签</FieldLabel><Input id={`${asset.id}-tags`} name="tags" defaultValue={asset.tags?.join(', ')} placeholder="产品，封面，已确认" disabled={busy} /><FieldDescription>多个标签用逗号分隔。</FieldDescription></Field>
    </FieldGroup>
    {error ? <Alert variant="destructive"><AlertDescription className="min-w-0 max-h-28 overflow-y-auto [overflow-wrap:anywhere]">{error}</AlertDescription></Alert> : null}
    <div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="xs" disabled={busy} onClick={close}><X data-icon="inline-start" />取消</Button><Button type="submit" size="xs" disabled={busy}>{busy ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Check data-icon="inline-start" />}{busy ? '保存中' : '保存更改'}</Button></div>
  </form>;
}
