import { useEffect, useRef, useState } from 'react';
import { Plus, Presentation, Upload } from 'lucide-react';
import * as api from '../../api';
import * as artifacts from '../../state/artifactStore';
import { useArtifactStore } from '../../state/useArtifactStore';
import { selectPresentation, usePresentationWorkspace } from '../../state/presentationWorkspace';
import { flushEditorEdits } from '../../state/editorPersistence';
import { createPresentation } from '../../../shared/presentationContent';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Alert, AlertDescription } from '../ui/alert';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '../ui/empty';
import PresentationEditor from './PresentationEditor';
export default function PresentationPanel({ sessionId }: { sessionId: string }) {
  const all = useArtifactStore((s) => s.bySession[sessionId]); const decks = (all ?? []).filter((a) => a.kind === 'presentation');
  const selectedId = usePresentationWorkspace((s) => s.selected[sessionId]); const selected = decks.find((a) => a.id === selectedId) ?? decks[0];
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { void artifacts.loadSessionArtifacts(sessionId); }, [sessionId]);
  async function act(action: () => Promise<void>) { setBusy(true); setError(''); try { await flushEditorEdits(sessionId); await action(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }
  async function create() { const name = `演示稿 ${decks.length + 1}`; const artifact = await api.createSessionArtifact(sessionId, { name, kind: 'presentation', source: 'manual', content: JSON.stringify(createPresentation(name)) }); artifacts.upsertArtifact(artifact); selectPresentation(sessionId, artifact.id); }
  async function upload(file?: File) { if (!file) return; const artifact = await api.importPresentation(sessionId, file); artifacts.upsertArtifact(artifact); selectPresentation(sessionId, artifact.id); }
  return <div className="flex h-full min-h-0 flex-col" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy) void act(() => upload(event.dataTransfer.files[0])); }}>
    <input hidden ref={fileInput} type="file" accept=".pptx,.reizo-ppt.json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void act(() => upload(file)); }} />
    <div className="flex items-center gap-2 border-b border-line p-2"><Presentation className="size-4 shrink-0 text-accent" /><div className="min-w-0 flex-1"><Select value={selected?.id ?? ''} disabled={busy || !decks.length} onValueChange={(id) => void act(async () => selectPresentation(sessionId, id))}><SelectTrigger aria-label="选择 PPT 演示稿"><SelectValue placeholder="PPT 工作区" /></SelectTrigger><SelectContent><SelectGroup>{decks.map((deck) => <SelectItem key={deck.id} value={deck.id}>{deck.name}</SelectItem>)}</SelectGroup></SelectContent></Select></div><Button size="sm" variant="outline" disabled={busy} onClick={() => void act(create)}><Plus data-icon="inline-start" />新建</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}><Upload data-icon="inline-start" />导入</Button></div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {selected ? <PresentationEditor key={selected.id} artifact={selected} /> : <Empty><EmptyHeader><EmptyMedia variant="icon"><Presentation /></EmptyMedia><EmptyTitle>PPT 工作区</EmptyTitle><EmptyDescription>按页编辑文字、图片、形状、表格与图表。</EmptyDescription></EmptyHeader><Button disabled={busy} onClick={() => void act(create)}>新建演示稿</Button></Empty>}
  </div>;
}
