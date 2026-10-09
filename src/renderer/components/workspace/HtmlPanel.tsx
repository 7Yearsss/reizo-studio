import { useEffect, useRef, useState } from 'react';
import { Code2, Plus, Upload } from 'lucide-react';
import * as api from '../../api';
import * as artifacts from '../../state/artifactStore';
import { useArtifactStore } from '../../state/useArtifactStore';
import { selectHtml, useHtmlWorkspace } from '../../state/htmlWorkspace';
import { flushEditorEdits } from '../../state/editorPersistence';
import { EMPTY_HTML, MAX_HTML_BYTES, validateHtmlContent } from '../../../shared/htmlContent';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Alert, AlertDescription } from '../ui/alert';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '../ui/empty';
import HtmlEditor from './HtmlEditor';

export default function HtmlPanel({ sessionId }: { sessionId: string }) {
  const all = useArtifactStore((s) => s.bySession[sessionId]);
  const pages = (all ?? []).filter((a) => a.kind === 'html');
  const selectedId = useHtmlWorkspace((s) => s.selected[sessionId]);
  const selected = pages.find((a) => a.id === selectedId) ?? pages[0];
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { void artifacts.loadSessionArtifacts(sessionId); }, [sessionId]);
  async function act(run: () => Promise<void>) {
    setBusy(true); setError('');
    try { await flushEditorEdits(sessionId); await run(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); } finally { setBusy(false); }
  }
  async function create(name: string, content: string) {
    const artifact = await api.createSessionArtifact(sessionId, { name, content: validateHtmlContent(content), kind: 'html', source: 'manual' });
    artifacts.upsertArtifact(artifact); selectHtml(sessionId, artifact.id);
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!/\.html?$/i.test(file.name) || file.size > MAX_HTML_BYTES) throw new Error('请选择 2 MB 以内的 HTML 文件');
    await create(file.name, new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
  }
  return <div className="flex h-full min-h-0 flex-col" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy) void act(() => upload(event.dataTransfer.files[0])); }}>
    <input ref={input} hidden type="file" accept=".html,.htm" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void act(() => upload(file)); }} />
    <div className="flex items-center gap-2 border-b border-line p-2"><Code2 className="size-4 shrink-0 text-accent" /><div className="min-w-0 flex-1">
      <Select value={selected?.id ?? ''} disabled={busy || !pages.length} onValueChange={(id) => void act(async () => { selectHtml(sessionId, id); })}><SelectTrigger aria-label="选择 HTML 页面"><SelectValue placeholder="HTML 工作区" /></SelectTrigger><SelectContent><SelectGroup>{pages.map((page) => <SelectItem key={page.id} value={page.id}>{page.name}</SelectItem>)}</SelectGroup></SelectContent></Select>
    </div><Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => create(`页面 ${pages.length + 1}.html`, EMPTY_HTML))}><Plus data-icon="inline-start" />新建</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}><Upload data-icon="inline-start" />导入</Button></div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {selected ? <HtmlEditor key={selected.id} artifact={selected} /> : <Empty><EmptyHeader><EmptyMedia variant="icon"><Code2 /></EmptyMedia><EmptyTitle>HTML 工作区</EmptyTitle><EmptyDescription>编辑页面源码并预览效果。选中源码交给 AI，查看修改差异后决定是否接受。</EmptyDescription></EmptyHeader><Button disabled={busy} onClick={() => void act(() => create('新页面.html', EMPTY_HTML))}>新建页面</Button></Empty>}
  </div>;
}
