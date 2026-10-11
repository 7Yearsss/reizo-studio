import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, BarChart3, Copy, Download, History, ImagePlus, MousePointerClick, Plus, Redo2, Shapes, Table, Trash2, Type, Undo2 } from 'lucide-react';
import type { Artifact, ArtifactWithContent } from '../../../shared/artifact';
import type { ArtifactReview } from '../../../shared/artifactReview';
import { createPresentation, normalizePresentation, parsePresentation, type PresentationContent, type PresentationSlide } from '../../../shared/presentationContent';
import * as api from '../../api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Alert, AlertDescription } from '../ui/alert';
import { useTextArtifact } from './useTextArtifact';
import PresentationSurface, { type PresentationEditingApi } from './PresentationSurface';
import ArtifactHistoryDialog from './ArtifactHistoryDialog';
import { referencePresentation, usePresentationWorkspace, dropPresentationScope, prunePresentationScope } from '../../state/presentationWorkspace';
import PresentationReview from './PresentationReview';
import { focusComposer, ReferenceStrip, SaveStatus } from './workspaceChrome';
import { createChartInsertElements, createElementInsertElements, createTableInsertElements, createTextInsertElements } from '../../vendor/presenton/insert/insert-elements';
import { TEMPLATE_V2_ASK_AI_EVENT, TEMPLATE_V2_INSERT_ELEMENTS_EVENT, TEMPLATE_V2_SURFACE_SELECTED_EVENT, type TemplateV2SurfaceSelectedDetail } from '../../vendor/presenton/events/events';
import type { SlideElement } from '../../vendor/presenton/types';
import { readPresentationImage } from '../../vendor/presenton/host';
import { exportPresentationPptx } from '../../lib/presentationPptx';

export default function PresentationEditor({ artifact }: { artifact: Artifact }) {
  const [full, setFull] = useState<ArtifactWithContent | null>(null); const [error, setError] = useState('');
  useEffect(() => { let cancelled = false; void api.getArtifact(artifact.id).then((next) => { if (!cancelled) setFull(next); }, (cause) => { if (!cancelled) setError(String(cause)); }); return () => { cancelled = true; }; }, [artifact.id, artifact.version]);
  return <>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}{full ? <Editor key={full.id} artifact={full} /> : <p role="status" className="p-4 text-xs">正在加载演示稿…</p>}</>;
}

function Editor({ artifact }: { artifact: ArtifactWithContent }) {
  const surface = useRef<PresentationEditingApi | null>(null);
  const draft = useTextArtifact(artifact, () => surface.current?.flush());
  const content = useMemo(() => parsePresentation(draft.text), [draft.text]);
  const [selectedId, setSelectedId] = useState(content?.slides[0]?.id);
  const selected = content?.slides.find((slide) => slide.id === selectedId) ?? content?.slides[0];
  // The editing engine owns its live layout and undo stack. Only an external
  // version or a page switch supplies a fresh initial layout.
  const initialSlide = useMemo(() => parsePresentation(draft.getText())?.slides.find((slide) => slide.id === selected?.id), [selected?.id, draft.source.generation]);
  const [busy, setBusy] = useState(false); const [history, setHistory] = useState(false);
  const [selection, setSelection] = useState<TemplateV2SurfaceSelectedDetail['selection']>();
  const [reviews, setReviews] = useState<ArtifactReview[]>([]);
  const revision = usePresentationWorkspace((s) => s.revisions[artifact.id]);
  const reference = usePresentationWorkspace((s) => s.references[artifact.sessionId]);
  const referenced = reference?.artifactId === artifact.id ? reference : undefined;
  useEffect(() => { let cancelled = false; void api.listArtifactReviews(artifact.id).then((next) => { if (!cancelled) setReviews(next); }, (cause) => { if (!cancelled) draft.setError(String(cause)); }); return () => { cancelled = true; }; }, [artifact.id, artifact.version, revision]);
  const [historyCommand, setHistoryCommand] = useState<{ action: 'undo' | 'redo'; token: number }>();
  const imageInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const listener = (event: Event) => { const detail = (event as CustomEvent<TemplateV2SurfaceSelectedDetail>).detail; if (detail.slideId === selected?.id) setSelection(detail.selection); };
    window.addEventListener(TEMPLATE_V2_SURFACE_SELECTED_EVENT, listener); return () => window.removeEventListener(TEMPLATE_V2_SURFACE_SELECTED_EVENT, listener);
  }, [selected?.id]);
  const root = useRef<HTMLDivElement>(null);
  const askRef = useRef<() => void>(() => { /* Assigned on every render below. */ });
  useEffect(() => {
    const ask = () => { if (root.current?.checkVisibility()) askRef.current(); };
    // Ctrl/Cmd+L hands the selection (or, with nothing selected, the current page) to the chat — same as Doc.
    // Tabs stay mounted while hidden, so only the visible editor answers, and never while typing elsewhere (e.g. the composer).
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'l') return;
      const host = root.current; const target = event.target as Node | null;
      if (!host?.checkVisibility() || (target !== document.body && !host.contains(target))) return;
      event.preventDefault(); askRef.current();
    };
    window.addEventListener(TEMPLATE_V2_ASK_AI_EVENT, ask); window.addEventListener('keydown', key);
    return () => { window.removeEventListener(TEMPLATE_V2_ASK_AI_EVENT, ask); window.removeEventListener('keydown', key); };
  }, []);
  function read(): PresentationContent { const value = parsePresentation(draft.getText()); if (!value) throw new Error('演示稿格式无效'); return value; }
  function change(next: PresentationContent) { const normalized = normalizePresentation(next); draft.change(JSON.stringify(normalized)); prunePresentationScope(artifact.sessionId, normalized); }
  async function act(action: () => Promise<void> | void) {
    if (busy) return; setBusy(true); draft.setError('');
    try { await draft.flush(); await action(); } catch (cause) { draft.setError(cause instanceof Error ? cause.message : '操作失败'); } finally { setBusy(false); }
  }
  function insert(elements: SlideElement[]) { surface.current?.flush(); const detail = { slideId: selected?.id, elements, label: '新元素', handled: false }; window.dispatchEvent(new CustomEvent(TEMPLATE_V2_INSERT_ELEMENTS_EVENT, { detail })); if (!detail.handled) draft.setError('元素未能插入，请重新打开当前页后重试'); }
  async function image(file?: File) { if (!file) return; const data = await readPresentationImage(file); insert([{ type: 'image', name: file.name, data, position: { x: 200, y: 180 }, size: { width: 500, height: 330 }, fit: 'contain' } as SlideElement]); }
  function addSlide(copy = false) {
    const next = read(); const current = next.slides.find((s) => s.id === selected?.id);
    const slide: PresentationSlide = copy && current ? JSON.parse(JSON.stringify(current)) : createPresentation(`第 ${next.slides.length + 1} 页`).slides[0];
    slide.id = crypto.randomUUID(); if (copy) slide.title += ' 副本';
    next.slides.splice(next.slides.findIndex((s) => s.id === selected?.id) + 1, 0, slide); const normalized = normalizePresentation(next); change(normalized); setSelectedId(slide.id); setSelection(null);
  }
  function move(offset: number) { const next = read(); const index = next.slides.findIndex((s) => s.id === selected?.id); const target = index + offset; if (target < 0 || target >= next.slides.length) return; [next.slides[index], next.slides[target]] = [next.slides[target], next.slides[index]]; change(next); }
  async function exportDeck() {
    const bytes = await exportPresentationPptx(read(), artifact.name);
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${artifact.name.replace(/\.pptx$/i, '')}.pptx`; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function recover() {
    setBusy(true);
    try {
      surface.current?.flush(); await draft.waitForSave()?.catch((): void => { /* The recovery download preserves this failed save. */ });
      const url = URL.createObjectURL(new Blob([draft.getText()], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${artifact.name}-恢复副本.reizo-ppt.json`; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      const latest = await api.getArtifact(artifact.id); surface.current = null; draft.load(latest); dropPresentationScope(artifact.sessionId); setSelection(null);
    } catch (cause) { draft.setError(String(cause)); } finally { setBusy(false); }
  }
  function cite(elements: boolean, wholeDeck = false) {
    const chosen = selection;
    const elementIds = elements && chosen ? chosen.kind === 'multi-component' ? chosen.componentIds : chosen.kind === 'component' ? [chosen.componentId] : [chosen.elementId] : undefined;
    const ids = elementIds?.filter((id): id is string => Boolean(id));
    if (elements && !ids?.length) { draft.setError('请先选择文字、图片、形状或组件'); return; }
    void act(() => { referencePresentation(artifact.sessionId, { artifactId: artifact.id, name: artifact.name, version: draft.getVersion(), slideId: wholeDeck ? undefined : selected?.id, elementIds: ids }); focusComposer(artifact.sessionId); });
  }
  askRef.current = () => { if (!busy) cite(Boolean(selection)); };
  if (!content || !selected || !initialSlide) return <Alert variant="destructive"><AlertDescription>演示稿格式无效</AlertDescription></Alert>;
  return <div ref={root} className="flex min-h-0 flex-1 flex-col">
    {content.importWarnings?.length ? <details className="border-b border-line px-3 py-2 text-xs text-ink-muted"><summary className="cursor-pointer">导入说明 · {content.importWarnings.length} 项{content.importWarnings.length > 1 ? '（包含格式转换提示）' : ''}</summary>{content.importWarnings.map((warning, index) => <p className="mt-1" key={index}>{warning}</p>)}{content.originalArtifactId && <Button size="xs" variant="link" onClick={() => { const id = content.originalArtifactId; if (id) void api.artifactRawUrl(id).then((url) => { const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${artifact.name}-原始.pptx`; document.body.append(anchor); anchor.click(); anchor.remove(); }); }}>下载原始 PPTX</Button>}</details> : null}
    <input hidden ref={imageInput} type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void act(() => image(file)); }} />
    <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1" data-inline-edit-ignore="true">
      <Button size="icon-sm" variant="ghost" className="size-7" aria-label="撤销 PPT 修改" title="撤销" disabled={busy} onClick={() => setHistoryCommand({ action: 'undo', token: Date.now() })}><Undo2 /></Button>
      <Button size="icon-sm" variant="ghost" className="size-7" aria-label="重做 PPT 修改" title="重做" disabled={busy} onClick={() => setHistoryCommand({ action: 'redo', token: Date.now() })}><Redo2 /></Button>
      <span aria-hidden className="mx-1 h-4 w-px bg-line" />
      <span className="mr-0.5 text-xs text-ink-muted">插入</span>
      <Button size="xs" variant="ghost" title="插入文本框" disabled={busy} onClick={() => insert(createTextInsertElements('body-text'))}><Type data-icon="inline-start" />文字</Button>
      <Button size="xs" variant="ghost" title="插入形状" disabled={busy} onClick={() => insert(createElementInsertElements('vector-rectangle'))}><Shapes data-icon="inline-start" />形状</Button>
      <Button size="xs" variant="ghost" title="插入表格" disabled={busy} onClick={() => insert(createTableInsertElements('simple-table'))}><Table data-icon="inline-start" />表格</Button>
      <Button size="xs" variant="ghost" title="插入柱状图" disabled={busy} onClick={() => insert(createChartInsertElements('bar'))}><BarChart3 data-icon="inline-start" />图表</Button>
      <Button size="xs" variant="ghost" title="插入本地图片" disabled={busy} onClick={() => imageInput.current?.click()}><ImagePlus data-icon="inline-start" />图片</Button>
      <div className="ml-auto flex items-center gap-1 pl-2">
        <SaveStatus status={draft.status} version={draft.getVersion()} failed={Boolean(draft.error)} />
        <Button size="icon-sm" variant="ghost" className="size-7" aria-label="PPT 版本历史" title="版本历史" disabled={busy} onClick={() => void act(() => setHistory(true))}><History /></Button>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void act(exportDeck)}><Download data-icon="inline-start" />导出 PPTX</Button>
      </div>
    </div>
    <ReferenceStrip attached={referenced ? (referenced.elementIds?.length ? `${referenced.elementIds.length} 个元素` : referenced.slideId ? `第 ${content.slides.findIndex((slide) => slide.id === referenced.slideId) + 1} 页` : '整份演示稿') : undefined}
      hint={selection?.targetLabel ? `已选：${selection.targetLabel} · Ctrl+L 交给 AI` : '双击文字编辑，拖动元素调整位置；选中元素后点「问 AI」或按 Ctrl+L'}>
      <Button size="xs" variant="ghost" disabled={busy || !selection} title="把选中的元素交给 AI（Ctrl+L）" onClick={() => cite(true)}><MousePointerClick data-icon="inline-start" />引用选中元素</Button>
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => cite(false)}>引用当前页</Button>
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => cite(false, true)}>引用整稿</Button>
    </ReferenceStrip>
    {draft.error && <Alert variant="destructive"><AlertDescription>{draft.error}<div className="mt-2 flex flex-wrap gap-2"><Button size="xs" variant="outline" disabled={busy} onClick={() => void act(() => undefined)}>重试保存</Button><Button size="xs" variant="outline" disabled={busy} onClick={() => void recover()}>下载恢复副本并重新载入</Button></div></AlertDescription></Alert>}
    <div className="flex min-h-0 flex-1"><aside className="flex w-28 shrink-0 flex-col gap-2 overflow-auto border-r border-line p-2" aria-label="幻灯片列表"><Button size="xs" disabled={busy} onClick={() => void act(() => addSlide())}><Plus data-icon="inline-start" />添加页</Button>{content.slides.map((slide, index) => <button key={slide.id} type="button" aria-label={`第 ${index + 1} 页：${slide.title}`} aria-pressed={selected.id === slide.id} className="rounded border border-line p-1 text-left transition-colors hover:border-ink-muted aria-pressed:border-accent aria-pressed:ring-1 aria-pressed:ring-accent" onClick={() => void act(() => { setSelectedId(slide.id); setSelection(null); dropPresentationScope(artifact.sessionId); })}><div className="pointer-events-none overflow-hidden"><PresentationSurface slide={slide} index={index} /></div><span className="mt-1 block truncate text-[11px]">{index + 1}. {slide.title}</span></button>)}</aside>
      <div className="min-w-0 flex-1 overflow-auto bg-paper-inset p-3"><div className="mb-3 flex items-center gap-1"><Input aria-label="幻灯片标题" value={selected.title} disabled={busy} onChange={(event) => { const next = read(); const slide = next.slides.find((s) => s.id === selected.id); if (slide) { slide.title = event.target.value; change(next); } }} /><Button size="icon-sm" variant="ghost" aria-label="复制当前页" disabled={busy} onClick={() => void act(() => addSlide(true))}><Copy /></Button><Button size="icon-sm" variant="ghost" aria-label="当前页上移" disabled={busy || content.slides[0].id === selected.id} onClick={() => void act(() => move(-1))}><ArrowUp /></Button><Button size="icon-sm" variant="ghost" aria-label="当前页下移" disabled={busy || content.slides.at(-1)?.id === selected.id} onClick={() => void act(() => move(1))}><ArrowDown /></Button><Button size="icon-sm" variant="ghost" aria-label="删除当前页" disabled={busy || content.slides.length === 1} onClick={() => void act(() => { const next = read(); next.slides = next.slides.filter((s) => s.id !== selected.id); change(next); setSelectedId(next.slides[0].id); })}><Trash2 /></Button></div>
        <div inert={busy} className="overflow-hidden rounded border border-line bg-white shadow-sm"><PresentationSurface key={`${selected.id}:${draft.source.generation}`} slide={initialSlide} index={content.slides.findIndex((s) => s.id === selected.id)} editable editingApiRef={surface} historyCommand={historyCommand} prepare={(layout) => { const next = read(); const slide = next.slides.find((s) => s.id === selected.id); if (slide) slide.layout = layout; return normalizePresentation(next).slides.find((s) => s.id === selected.id)?.layout ?? layout; }} onChange={(layout) => { const next = read(); const slide = next.slides.find((s) => s.id === selected.id); if (slide) { slide.layout = layout; change(next); } }} /></div>
        <PresentationReview reviews={reviews} busy={busy} decide={(review, ids, decision) => void act(async () => {
          try {
            const result = await api.decideArtifactReview(artifact.id, review.id, review.reviewVersion, ids, decision);
            if (result.artifact.version !== draft.getVersion()) { draft.load(result.artifact); surface.current = null; setSelection(null); dropPresentationScope(artifact.sessionId); }
          } finally { setReviews(await api.listArtifactReviews(artifact.id)); }
        })} />
      </div>
    </div>
    {history && <ArtifactHistoryDialog artifact={{ ...artifact, version: draft.getVersion() }} close={() => setHistory(false)} flush={draft.flush} getVersion={draft.getVersion} render={(text) => <div className="flex flex-col gap-3 p-3">{parsePresentation(text)?.slides.map((slide, index) => <PresentationSurface key={slide.id} slide={slide} index={index} />)}</div>} restored={async () => { draft.load(await api.getArtifact(artifact.id)); dropPresentationScope(artifact.sessionId); setSelection(null); }} />}
  </div>;
}
