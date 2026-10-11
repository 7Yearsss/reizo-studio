import { useRef, useState, type ReactNode } from 'react';
import { Check, CircleAlert, FileUp, Loader2, Plus, Sparkles, Upload, X } from 'lucide-react';
import type { Artifact } from '../../../shared/artifact';
import type { ArtifactReview } from '../../../shared/artifactReview';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Alert, AlertDescription } from '../ui/alert';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '../ui/empty';
import { cn } from '../../lib/cn';

/** Ask the chat composer of this session to take focus (after a reference was attached). */
export function focusComposer(sessionId: string, options: { cite?: boolean } = {}) {
  // `cite`: a range was just attached; the composer drops its chip at the caret so it can be mentioned in the sentence.
  window.dispatchEvent(new CustomEvent('reizo:focus-composer', { detail: { sessionId, ...(options.cite ? { cite: true } : {}) } }));
}

const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

interface ShellProps {
  icon: ReactNode;
  /** Workspace name, e.g. "Doc 工作区". */
  title: string;
  /** What one item is called, e.g. "文档". */
  noun: string;
  items: Artifact[];
  selected: Artifact | undefined;
  /** Runs before every action so the open editor's pending edits are saved first. */
  flush(): Promise<void>;
  select(id: string): void;
  create(): Promise<void>;
  /** Imports dropped or picked files; throws a user-facing message on a bad file. */
  importFiles(files: File[]): Promise<void>;
  accept: string;
  multiple?: boolean;
  /** Shown on the drop overlay and import tooltip, e.g. ".docx · 8 MB 以内". */
  importHint: string;
  importLabel: string;
  description: string;
  children: ReactNode;
}

/** Shared chrome of the office workspaces: item picker, new/import, drag-and-drop, errors and the empty state. */
export function WorkspaceShell({ icon, title, noun, items, selected, flush, select, create, importFiles, accept, multiple, importHint, importLabel, description, children }: ShellProps) {
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [busy, setBusy] = useState<'' | 'create' | 'import' | 'switch'>('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  async function action(kind: 'create' | 'import' | 'switch', run: () => Promise<void>) {
    setBusy(kind); setError('');
    try { await flush(); await run(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { setBusy(''); }
  }
  const upload = (files: File[]): void => { if (files.length) void action('import', () => importFiles(files)); };
  const newItem = (): void => void action('create', create);
  const pickFile = () => input.current?.click();
  const spinner = <Loader2 data-icon="inline-start" className="animate-spin" />;
  return <div className="relative flex h-full min-h-0 flex-col"
    onDragEnter={(event) => { if (!hasFiles(event)) return; dragDepth.current += 1; setDragging(true); }}
    onDragOver={(event) => event.preventDefault()}
    onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
    onDrop={(event) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (!busy) upload(Array.from(event.dataTransfer.files)); }}>
    <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; upload(files); }} />
    <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-paper-inset text-ink [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1"><Select value={selected?.id ?? ''} disabled={Boolean(busy) || !items.length} onValueChange={(id) => void action('switch', async () => { select(id); })}>
        <SelectTrigger size="sm" className="w-full" aria-label={`选择${noun}`}><SelectValue placeholder={title} /></SelectTrigger>
        <SelectContent><SelectGroup>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
      </Select></div>
      {items.length > 1 && <span className="hidden shrink-0 text-xs tabular-nums text-ink-muted sm:inline">{items.length} 份</span>}
      <Button variant="ghost" size="sm" disabled={Boolean(busy)} title={`新建${noun}`} onClick={newItem}>{busy === 'create' ? spinner : <Plus data-icon="inline-start" />}新建</Button>
      <Button variant="outline" size="sm" disabled={Boolean(busy)} title={`导入 ${importHint}，也可以直接拖进来`} onClick={pickFile}>{busy === 'import' ? spinner : <Upload data-icon="inline-start" />}{busy === 'import' ? '导入中…' : '导入'}</Button>
    </div>
    {error && <Alert variant="destructive" className="rounded-none border-x-0 border-t-0"><AlertDescription className="flex items-start gap-2"><span className="min-w-0 flex-1">{error}</span><button type="button" aria-label="关闭提示" className="shrink-0 opacity-70 hover:opacity-100" onClick={() => setError('')}><X className="size-3.5" /></button></AlertDescription></Alert>}
    {selected ? children : <Empty>
      <EmptyHeader><EmptyMedia variant="icon">{icon}</EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>
      <EmptyContent><div className="flex gap-2">
        <Button size="sm" disabled={Boolean(busy)} onClick={newItem}><Plus data-icon="inline-start" />新建{noun}</Button>
        <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={pickFile}><Upload data-icon="inline-start" />{importLabel}</Button>
      </div><p className="text-xs text-ink-muted">或把文件拖到这里（{importHint}）</p></EmptyContent>
    </Empty>}
    {dragging && <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent bg-paper-raised/90 text-sm text-ink" aria-hidden>
      <FileUp className="size-6 text-accent" />松开即可{importLabel}<span className="text-xs text-ink-muted">{importHint}</span>
    </div>}
  </div>;
}

/** Save state with an icon: saving / saved / unsaved / failed. */
export function SaveStatus({ status, version, failed }: { status: string; version: number; failed: boolean }) {
  const saving = status === '正在保存…'; const saved = status === '已保存';
  return <span role="status" className={cn('flex shrink-0 items-center gap-1 text-xs tabular-nums', failed ? 'text-destructive' : 'text-ink-muted')} title={`版本 v${version}`}>
    {failed ? <CircleAlert className="size-3" /> : saving ? <Loader2 className="size-3 animate-spin" /> : saved ? <Check className="size-3" /> : <span aria-hidden className="size-1.5 rounded-full bg-[var(--peach-bar)]" />}
    {status} · v{version}
  </span>;
}

/** The strip under an editor's toolbar that hands content to the chat: what is attached, plus the reference buttons. */
export function ReferenceStrip({ attached, hint, children }: { attached?: string; hint?: string; children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-paper-inset px-4 py-2 text-xs" data-inline-edit-ignore="true">
    {(attached || hint) && <Sparkles className="size-3.5 shrink-0 text-ink-muted" />}
    <span className={cn('min-w-0 flex-1 truncate', attached ? 'text-ink' : 'text-ink-muted')} title={attached ?? hint}>{attached ?? hint}</span>
    <div className="flex shrink-0 items-center gap-0.5">{children}</div>
  </div>;
}

/** Decided changes across all review batches, newest batches last. */
export function ReviewLog({ reviews, className }: { reviews: ArtifactReview[]; className?: string }) {
  const done = reviews.flatMap((r) => r.changes.filter((c) => c.status !== 'pending'));
  if (!done.length) return null;
  const accepted = done.filter((c) => c.status === 'accepted').length;
  return <details className={cn('rounded-xl bg-paper-raised px-3 py-2 shadow-[var(--shadow-outline)]', className)}><summary className="cursor-pointer text-xs text-ink-muted">审核记录 · 接受 {accepted} · 拒绝 {done.length - accepted}</summary>
    <ul className="mt-1.5 flex flex-col gap-1">{done.map((c) => <li className="flex items-start gap-1.5 text-xs" key={c.id}>
      {c.status === 'accepted' ? <Check className="mt-0.5 size-3 shrink-0 text-success" /> : <X className="mt-0.5 size-3 shrink-0 text-ink-muted" />}
      <span className={c.status === 'accepted' ? 'min-w-0 flex-1' : 'min-w-0 flex-1 text-ink-muted line-through'}>{c.label}</span>
      {c.status === 'accepted' && <span className="shrink-0 tabular-nums text-ink-muted">v{c.acceptedVersion}</span>}
    </li>)}</ul>
  </details>;
}
