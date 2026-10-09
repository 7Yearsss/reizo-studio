import { useEffect, useRef, useState } from 'react';
import { FileText, Plus, Upload } from 'lucide-react';
import * as api from '../../api';
import * as artifacts from '../../state/artifactStore';
import { useArtifactStore } from '../../state/useArtifactStore';
import { selectDocument, useDocumentWorkspace } from '../../state/documentWorkspace';
import { flushEditorEdits } from '../../state/editorPersistence';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Alert, AlertDescription } from '../ui/alert';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '../ui/empty';
import DocumentEditor from './DocumentEditor';

export default function DocumentPanel({ sessionId }: { sessionId: string }) {
  const all = useArtifactStore((s) => s.bySession[sessionId]);
  const documents = (all ?? []).filter((a) => a.kind === 'doc');
  const selectedId = useDocumentWorkspace((s) => s.selected[sessionId]);
  const selected = documents.find((a) => a.id === selectedId) ?? documents[0];
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void artifacts.loadSessionArtifacts(sessionId); }, [sessionId]);
  async function action(run: () => Promise<void>) {
    setBusy(true); setError('');
    try { await flushEditorEdits(sessionId); await run(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { setBusy(false); }
  }
  async function create() {
    const doc = await api.createDocument(sessionId, `文档 ${documents.length + 1}`);
    artifacts.upsertArtifact(doc); selectDocument(sessionId, doc.id);
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!/\.docx$/i.test(file.name) || file.size > 8 * 1024 * 1024) throw new Error('请选择 8 MB 以内的 .docx 文件');
    const doc = await api.importDocument(sessionId, file);
    artifacts.upsertArtifact(doc); selectDocument(sessionId, doc.id);
  }
  return <div className="flex h-full min-h-0 flex-col" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy) void action(() => upload(event.dataTransfer.files[0])); }}>
    <input ref={input} type="file" hidden accept=".docx" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void action(() => upload(file)); }} />
    <div className="flex items-center gap-2 border-b border-line p-2">
      <FileText className="size-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1"><Select value={selected?.id ?? ''} disabled={busy || !documents.length} onValueChange={(id) => void action(async () => { selectDocument(sessionId, id); })}>
        <SelectTrigger aria-label="选择 Doc 文档"><SelectValue placeholder="Doc 工作区" /></SelectTrigger>
        <SelectContent><SelectGroup>{documents.map((doc) => <SelectItem key={doc.id} value={doc.id}>{doc.name}</SelectItem>)}</SelectGroup></SelectContent>
      </Select></div>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void action(create)}><Plus data-icon="inline-start" />新建</Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}><Upload data-icon="inline-start" />导入</Button>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {selected ? <DocumentEditor key={selected.id} artifact={selected} /> : <Empty><EmptyHeader><EmptyMedia variant="icon"><FileText /></EmptyMedia><EmptyTitle>Doc 工作区</EmptyTitle><EmptyDescription>编辑文档或导入 Word 文件。选中文字交给 AI 修改，逐项审核后才会更新原文。</EmptyDescription></EmptyHeader><Button disabled={busy} onClick={() => void action(create)}>新建文档</Button></Empty>}
  </div>;
}
