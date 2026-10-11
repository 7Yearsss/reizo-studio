import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor as TiptapEditor } from '@tiptap/react';
import { Bold, Italic, Underline, Strikethrough, List, ListOrdered, Table, Undo2, Redo2, Quote, History, Sparkles, Info, PenLine, ListChecks, Search, ListTree } from 'lucide-react';
import type { Artifact, ArtifactWithContent } from '../../../shared/artifact';
import type { ArtifactReview } from '../../../shared/artifactReview';
import { documentExtensions, documentSelectionIntact, documentSelectionBetween, normalizeDocumentContent, parseDocumentContent, typographyCss, type DocumentContent, type DocumentSelection } from '../../../shared/documentContent';
import * as api from '../../api';
import * as chatStore from '../../state/chatStore';
import { useChatStore } from '../../state/useChatStore';
import { serializeDocumentReference } from '../../../shared/documentReferences';
import * as artifacts from '../../state/artifactStore';
import { clearEditorRecovery, getEditorRecovery, registerEditorFlusher, setEditorRecovery, trackEditorWrite } from '../../state/editorPersistence';
import { addDocumentReference, dropDocumentSelection, reconcileDocumentSelection, syncDocumentReferenceVersion, useDocumentWorkspace } from '../../state/documentWorkspace';
import { labelSelections } from '../../../shared/referenceLabels';
import { referenceDecorations, referenceMarksKey, referenceMarksPlugin, type LabelledRange } from './referenceMarks';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { cn } from '../../lib/cn';
import DocumentReview from './DocumentReview';
import { focusComposer, ReferenceStrip, ReviewLog, SaveStatus } from './workspaceChrome';
import ArtifactHistoryDialog from './ArtifactHistoryDialog';
import DocumentReadOnly from './DocumentReadOnly';
import ExportMenu from './ExportMenu';
import FormatMenu, { FormatPreviewBar } from './FormatMenu';
import FormatControls from './FormatControls';
import FindBar from './FindBar';
import OutlinePanel from './OutlinePanel';
import { docSearchKey, docSearchPlugin } from './docSearch';
import { applyFormat, type FormatResult, type FormatSpec } from '../../../shared/documentFormat';
import { toast } from '../../lib/toast';
import InlineEditCard, { type InlineEditPhase } from './InlineEditCard';
import { inlineEditDecorations, inlineEditMarksKey, inlineEditMarksPlugin } from './inlineEditMarks';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type BlockStyle = 'paragraph' | 'h1' | 'h2' | 'h3';
const BLOCK_LABEL: Record<BlockStyle, string> = { paragraph: '正文', h1: '标题 1', h2: '标题 2', h3: '标题 3' };

function ToolButton({ label, shortcut, active, disabled, onClick, children }: { label: string; shortcut?: string; active?: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return <Button size="icon-sm" variant="ghost" aria-label={label} title={shortcut ? `${label}（${shortcut}）` : label} aria-pressed={active} disabled={disabled}
    className={cn('size-7', active && 'bg-paper-inset text-accent')} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</Button>;
}

type Chain = ReturnType<TiptapEditor['chain']>;

function FormatTools({ editor, disabled }: { editor: TiptapEditor | null; disabled: boolean }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => e ? {
      block: (e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : 'paragraph') as BlockStyle,
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), quote: e.isActive('blockquote'),
      undo: e.can().undo(), redo: e.can().redo(),
    } : null,
  });
  const off = !editor || disabled;
  const run = (fn: (chain: Chain) => Chain) => { if (editor) fn(editor.chain().focus()).run(); };
  const sep = <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-line" />;
  return <>
    <Select value={state?.block ?? 'paragraph'} disabled={off} onValueChange={(value) => run((c) => value === 'paragraph' ? c.setParagraph() : c.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }))}>
      <SelectTrigger size="sm" aria-label="段落样式" className="h-7 w-[5.5rem] border-transparent px-2 text-xs hover:bg-paper-inset"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{(Object.keys(BLOCK_LABEL) as BlockStyle[]).map((key) => <SelectItem key={key} value={key}>{BLOCK_LABEL[key]}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
    {sep}
    <ToolButton label="加粗" shortcut="Ctrl+B" active={state?.bold} disabled={off} onClick={() => run((c) => c.toggleBold())}><Bold /></ToolButton>
    <ToolButton label="斜体" shortcut="Ctrl+I" active={state?.italic} disabled={off} onClick={() => run((c) => c.toggleItalic())}><Italic /></ToolButton>
    <ToolButton label="下划线" shortcut="Ctrl+U" active={state?.underline} disabled={off} onClick={() => run((c) => c.toggleUnderline())}><Underline /></ToolButton>
    <ToolButton label="删除线" active={state?.strike} disabled={off} onClick={() => run((c) => c.toggleStrike())}><Strikethrough /></ToolButton>
    <FormatControls editor={editor} disabled={off} />
    {sep}
    <ToolButton label="项目列表" active={state?.bullet} disabled={off} onClick={() => run((c) => c.toggleBulletList())}><List /></ToolButton>
    <ToolButton label="编号列表" active={state?.ordered} disabled={off} onClick={() => run((c) => c.toggleOrderedList())}><ListOrdered /></ToolButton>
    <ToolButton label="引用块" active={state?.quote} disabled={off} onClick={() => run((c) => c.toggleBlockquote())}><Quote /></ToolButton>
    <ToolButton label="插入表格" disabled={off} onClick={() => run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}><Table /></ToolButton>
    {sep}
    <ToolButton label="撤销" shortcut="Ctrl+Z" disabled={off || !state?.undo} onClick={() => run((c) => c.undo())}><Undo2 /></ToolButton>
    <ToolButton label="重做" shortcut="Ctrl+Shift+Z" disabled={off || !state?.redo} onClick={() => run((c) => c.redo())}><Redo2 /></ToolButton>
  </>;
}

/** Where to float the ask-AI pill, in the scroller's content coordinates: above the end the selection was dragged to. */
function bubbleAt(editor: TiptapEditor, box: HTMLElement | null): { top: number; left: number } | null {
  if (!box) return null;
  try {
    const { head } = editor.state.selection;
    const at = editor.view.coordsAtPos(head);
    const rect = box.getBoundingClientRect();
    const above = at.top - rect.top + box.scrollTop - 40;
    const top = above < box.scrollTop + 4 ? at.bottom - rect.top + box.scrollTop + 8 : above;
    return { top, left: Math.min(Math.max(at.left - rect.left + box.scrollLeft, 70), box.clientWidth - 70) };
  } catch { return null; }
}

/** Where the instruction card sits: just under the line the selection ends on. */
function cardAt(editor: TiptapEditor, box: HTMLElement | null): { top: number; left: number } | null {
  if (!box) return null;
  try {
    const at = editor.view.coordsAtPos(editor.state.selection.to);
    const rect = box.getBoundingClientRect();
    return { top: at.bottom - rect.top + box.scrollTop + 8, left: Math.min(Math.max(at.left - rect.left + box.scrollLeft - 24, 8), Math.max(8, box.clientWidth - 348)) };
  } catch { return null; }
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);

export default function DocumentEditor({ artifact }: { artifact: Artifact }) {
  const [full, setFull] = useState<ArtifactWithContent | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void api.getArtifact(artifact.id).then((doc) => { if (!cancelled) { setFull(doc); setError(''); } }, (cause) => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [artifact.id, artifact.version]);
  return <>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}{full ? <Editor key={full.id} artifact={full} /> : <p role="status" className="p-4 text-xs">正在加载文档…</p>}</>;
}

function Editor({ artifact }: { artifact: ArtifactWithContent }) {
  const [initial] = useState(() => {
    const recovered = getEditorRecovery(artifact.id);
    const content = parseDocumentContent(recovered?.content ?? artifact.content);
    if (!content) throw new Error('文档格式无效');
    return { content, version: recovered?.expectedVersion ?? artifact.version, recovered };
  });
  const value = useRef<DocumentContent>(initial.content);
  const version = useRef(initial.version);
  const dirty = useRef(Boolean(initial.recovered));
  const writing = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const [status, setStatus] = useState(initial.recovered ? '有未保存内容' : '已保存');
  const [error, setError] = useState(initial.recovered?.error ?? '');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const [selection, setSelection] = useState<DocumentSelection | undefined>();
  const [reviews, setReviews] = useState<ArtifactReview[]>([]);
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null);
  const [edit, setEdit] = useState<{ selection: DocumentSelection; from: number; to: number; at: { top: number; left: number }; phase: InlineEditPhase; notice?: string } | null>(null);
  const stopped = useRef(false);
  const [outlineOpen, setOutlineOpen] = useState(() => { try { return localStorage.getItem('reizo:doc-outline') === '1'; } catch { return false; } });
  const toggleOutline = () => setOutlineOpen((open) => { try { localStorage.setItem('reizo:doc-outline', open ? '0' : '1'); } catch { /* the choice just is not remembered */ } return !open; });
  const [find, setFind] = useState<{ replace: boolean; initial: string; nonce: number } | null>(null);
  const openFindRef = useRef<(replace: boolean) => void>(() => { /* Assigned on every render below. */ });
  const saveLabel = useRef<'排版' | undefined>(undefined);
  const [formatPreview, setFormatPreview] = useState<{ name: string; original: DocumentContent; result: FormatResult; view: 'after' | 'before' } | null>(null);
  const openEditRef = useRef<() => void>(() => { /* Assigned on every render below. */ });
  const aiBusy = useChatStore((state) => Boolean(state.sendingBySession[artifact.sessionId]));
  const aiWaiting = useChatStore((state) => Boolean(state.interactionBySession[artifact.sessionId]));
  const pointerDown = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const askRef = useRef<() => void>(() => { /* Assigned on every render below. */ });
  const references = useDocumentWorkspace((s) => s.references[artifact.sessionId]);
  // Numbered like the composer chips (labels run across every referenced document).
  const referenced = useMemo(() => labelSelections(references ?? []).filter((r) => r.artifactId === artifact.id), [references, artifact.id]);
  const pickedRanges = useMemo(() => referenced.filter((r): r is typeof r & LabelledRange => Boolean(r.selection && r.label)), [referenced]);
  const revision = useDocumentWorkspace((s) => s.revisions[artifact.id]);
  const activeReview = reviews.find((r) => r.changes.some((c) => c.status === 'pending'));
  const pendingBatches = reviews.filter((r) => r.changes.some((c) => c.status === 'pending')).length;
  const refreshReviews = useCallback(async () => { const next = await api.listArtifactReviews(artifact.id); if (mounted.current) setReviews(next); }, [artifact.id]);
  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    if (writing.current) return writing.current;
    const task = Promise.resolve().then(async () => {
      while (dirty.current) {
        const snapshot = JSON.stringify(value.current);
        const normalized = normalizeDocumentContent(value.current);
        const raw = JSON.stringify(normalized);
        if (mounted.current) setStatus('正在保存…');
        const label = saveLabel.current; saveLabel.current = undefined;
        const saved = await api.addArtifactVersion(artifact.id, raw, version.current, label);
        version.current = saved.version;
        syncDocumentReferenceVersion(artifact.sessionId, artifact.id, saved.version);
        dirty.current = JSON.stringify(value.current) !== snapshot;
        if (!dirty.current) value.current = normalized;
        artifacts.upsertArtifact(saved);
        if (!dirty.current) clearEditorRecovery(artifact.id);
        else setEditorRecovery(artifact.id, { sessionId: artifact.sessionId, content: JSON.stringify(value.current), expectedVersion: version.current });
      }
      if (mounted.current) { setStatus('已保存'); setError(''); }
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : '保存失败';
      setEditorRecovery(artifact.id, { sessionId: artifact.sessionId, content: JSON.stringify(value.current), expectedVersion: version.current, error: message });
      if (mounted.current) { setError(message); setStatus('尚未保存'); }
      throw cause;
    }).finally(() => { writing.current = null; });
    writing.current = trackEditorWrite(artifact.sessionId, task);
    return task;
  }, [artifact.id, artifact.sessionId]);
  const editor = useEditor({
    extensions: documentExtensions(), content: initial.content.doc,
    editorProps: { attributes: { class: 'document-prose min-h-[60vh] px-8 py-7 outline-none', style: typographyCss(initial.content), 'aria-label': '文档正文', role: 'textbox', 'aria-multiline': 'true' },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'l') { event.preventDefault(); askRef.current(); return true; }
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'j') { event.preventDefault(); openEditRef.current(); return true; }
        // Find stays in the document: the chat's own Ctrl+F must not also fire.
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && ['f', 'h'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); openFindRef.current(event.key.toLowerCase() === 'h'); return true; }
        return false;
      } },
    onBlur: () => setBubble(null),
    onUpdate: ({ editor: current }) => {
      if (JSON.stringify(value.current.doc) === JSON.stringify(current.getJSON())) return;
      value.current = { ...value.current, doc: current.getJSON() }; dirty.current = true; setStatus('尚未保存');
      setEditorRecovery(artifact.id, { sessionId: artifact.sessionId, content: JSON.stringify(value.current), expectedVersion: version.current });
      // Typing elsewhere keeps the reference; the selection only goes once its own text moved or changed.
      reconcileDocumentSelection(artifact.sessionId, artifact.id, (selected) => documentSelectionIntact(current.state.doc, selected));
      clearTimeout(timer.current); timer.current = setTimeout(() => { void flush().catch((): void => { /* Error is shown by the save/review handler. */ }); }, 700);
    },
    onSelectionUpdate: ({ editor: current }) => {
      const { $from, $to, empty } = current.state.selection;
      setSelection(empty ? undefined : documentSelectionBetween(current.state.doc, $from.pos, $to.pos));
      // The pill only appears once the selection has settled: after the mouse is released, or a
      // short pause for keyboard selection. While dragging it would sit in the way.
      setBubble(null);
      clearTimeout(settleTimer.current);
      if (empty || pointerDown.current) return;
      settleTimer.current = setTimeout(() => { if (!current.isDestroyed && !current.state.selection.empty) setBubble(bubbleAt(current, scroller.current)); }, 260);
    },
  });
  useEffect(() => {
    const release = () => {
      if (!pointerDown.current) return;
      pointerDown.current = false;
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => { if (editor && !editor.isDestroyed && !editor.state.selection.empty) setBubble(bubbleAt(editor, scroller.current)); }, 0);
    };
    window.addEventListener('pointerup', release);
    return () => { window.removeEventListener('pointerup', release); clearTimeout(settleTimer.current); };
  }, [editor]);
  useEffect(() => {
    mounted.current = true;
    const unregister = registerEditorFlusher(artifact.sessionId, artifact.id, flush);
    return () => { mounted.current = false; clearTimeout(timer.current); unregister(); void flush().catch((): void => { /* Error is shown by the save/review handler. */ }); };
  }, [artifact.id, artifact.sessionId, flush]);
  useEffect(() => { void refreshReviews().catch((cause) => setError(String(cause))); }, [refreshReviews, revision, artifact.version]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.registerPlugin(referenceMarksPlugin());
    editor.registerPlugin(inlineEditMarksPlugin());
    editor.registerPlugin(docSearchPlugin());
    return () => { if (!editor.isDestroyed) { editor.unregisterPlugin(referenceMarksKey); editor.unregisterPlugin(inlineEditMarksKey); editor.unregisterPlugin(docSearchKey); } };
  }, [editor]);
  useEffect(() => {
    if (!editor || editor.isDestroyed || !inlineEditMarksKey.getState(editor.state)) return;
    editor.view.dispatch(editor.state.tr.setMeta(inlineEditMarksKey, inlineEditDecorations(editor.state.doc, edit ? { from: edit.from, to: edit.to } : null)).setMeta('addToHistory', false));
  }, [editor, edit?.from, edit?.to]);
  useEffect(() => {
    if (!editor || editor.isDestroyed || !referenceMarksKey.getState(editor.state)) return;
    editor.view.dispatch(editor.state.tr.setMeta(referenceMarksKey, referenceDecorations(editor.state.doc, pickedRanges)).setMeta('addToHistory', false));
  }, [editor, pickedRanges]);
  useEffect(() => {
    if (!editor || artifact.version <= version.current) return;
    if (dirty.current) { setError('原文已有新版本，当前未保存内容已保留。可下载恢复副本后重新载入。'); return; }
    const content = parseDocumentContent(artifact.content); if (!content) return;
    value.current = content; version.current = artifact.version;
    editor.commands.setContent(content.doc, { emitUpdate: false });
    dropDocumentSelection(artifact.sessionId); setSelection(undefined); setStatus('已保存');
  }, [artifact, editor]);
  async function act(run: () => Promise<void>) {
    setBusy(true); editor?.setEditable(false, false); setError('');
    try { await flush(); await run(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); await refreshReviews().catch((): void => { /* Error is shown by the save/review handler. */ }); return false; }
    finally { setBusy(false); editor?.setEditable(true, false); }
  }
  function askAI(selected: DocumentSelection | undefined) {
    setBubble(null);
    void act(async () => {
      addDocumentReference(artifact.sessionId, { artifactId: artifact.id, name: artifact.name, version: version.current, ...(selected ? { selection: selected } : {}) });
      focusComposer(artifact.sessionId, { cite: Boolean(selected) });
    });
  }
  /** Rewrite the selection, or, with only a caret, the paragraph it is in. */
  function openEdit() {
    if (!editor || editor.isDestroyed || busy || activeReview || edit || formatPreview) return;
    let target = selection; let { from, to } = editor.state.selection;
    if (editor.state.selection.empty || !target) {
      const { $from } = editor.state.selection;
      if (!$from.parent.isTextblock || typeof $from.parent.attrs.id !== 'string' || !$from.parent.content.size) return;
      from = $from.start(); to = $from.end();
      target = documentSelectionBetween(editor.state.doc, from, to);
    }
    if (!target) return;
    setBubble(null);
    setEdit({ selection: target, from, to, at: cardAt(editor, scroller.current) ?? { top: 8, left: 8 }, phase: 'input' });
  }
  function openFind(replace: boolean) {
    if (!editor || editor.isDestroyed) return;
    const { from, to, empty } = editor.state.selection;
    const picked = empty ? '' : editor.state.doc.textBetween(from, to, ' ');
    setFind({ replace, initial: picked.length <= 60 && !picked.includes('\n') ? picked : '', nonce: Date.now() });
  }
  function closeFind() {
    setFind(null);
    if (editor && !editor.isDestroyed) editor.commands.focus(undefined, { scrollIntoView: false });
  }
  openFindRef.current = openFind;
  function closeEdit(refocus = true) {
    setEdit(null);
    if (refocus && editor && !editor.isDestroyed) editor.commands.focus(undefined, { scrollIntoView: false });
  }
  /** Send the typed instruction about the picked range as a normal chat turn; the answer arrives as a reviewable suggestion in the page. */
  async function submitEdit(instruction: string) {
    const target = edit;
    if (!target || !editor || editor.isDestroyed) return;
    stopped.current = false;
    setEdit({ ...target, phase: 'working' });
    editor.setEditable(false, false);
    let failure = '';
    try {
      await flush();
      const ref = { artifactId: artifact.id, name: artifact.name, version: version.current, selection: target.selection, label: 1 };
      await chatStore.sendMessage(artifact.sessionId, `修改 [1]：${instruction}`, [serializeDocumentReference(ref)]);
      // The turn can outlive the send call while it waits on an approval; the card stays until it is really over.
      while (mounted.current && chatStore.getSnapshot().sendingBySession[artifact.sessionId]) await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (cause) { failure = cause instanceof Error ? cause.message : '发送失败'; }
    if (!mounted.current) return;
    if (!editor.isDestroyed) editor.setEditable(true, false);
    const next = await api.listArtifactReviews(artifact.id).catch(() => reviews);
    if (!mounted.current) return;
    setReviews(next);
    if (next.some((review) => review.changes.some((change) => change.status === 'pending'))) { setEdit(null); return; }
    setEdit((current) => current && { ...current, phase: 'notice', notice: failure || (stopped.current ? '已停止' : 'AI 在对话里回复了，没有生成修改建议') });
  }
  /** Hand the whole document to the agent for a consistency audit; the fixes arrive as reviewable suggestions. */
  async function audit() {
    await act(async () => {
      await flush();
      const ref = { artifactId: artifact.id, name: artifact.name, version: version.current };
      void chatStore.sendMessage(artifact.sessionId, '检查全文一致性（序号、标点、日期和数字格式、空格、重复内容），并给出可逐条审核的修改建议', [serializeDocumentReference(ref)]);
      focusComposer(artifact.sessionId);
    });
  }
  /** Typeset by a spec: shown on the page as a preview first; saved only when applied, as its own history entry. */
  async function previewFormat(spec: FormatSpec) {
    if (!editor || editor.isDestroyed || formatPreview) return;
    let original: DocumentContent | undefined;
    // `act` re-enables editing when it finishes, so the preview is set up after it.
    await act(async () => { await flush(); original = value.current; });
    if (!original || editor.isDestroyed) return;
    const result = applyFormat(original, spec);
    if (!result.changed) { toast.info('已经符合这个格式'); return; }
    editor.setEditable(false, false);
    editor.commands.setContent(result.content.doc, { emitUpdate: false });
    setBubble(null); setSelection(undefined);
    setFormatPreview({ name: spec.name, original, result, view: 'after' });
  }
  async function previewReferenceFormat(file: File) {
    try { await previewFormat(await api.referenceFormat(file)); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : '范文读取失败'); }
  }
  function showFormatView(view: 'after' | 'before') {
    if (!editor || editor.isDestroyed || !formatPreview) return;
    editor.commands.setContent((view === 'after' ? formatPreview.result.content : formatPreview.original).doc, { emitUpdate: false });
    setFormatPreview({ ...formatPreview, view });
  }
  function cancelFormat() {
    if (!editor || editor.isDestroyed || !formatPreview) return;
    editor.commands.setContent(formatPreview.original.doc, { emitUpdate: false });
    editor.setEditable(true, false);
    setFormatPreview(null);
  }
  function applyFormatPreview() {
    if (!editor || editor.isDestroyed || !formatPreview) return;
    value.current = { ...formatPreview.result.content };
    editor.commands.setContent(formatPreview.result.content.doc, { emitUpdate: false });
    editor.setEditable(true, false);
    dirty.current = true; saveLabel.current = '排版'; setStatus('尚未保存');
    setFormatPreview(null);
    void flush().then(() => toast.success('已应用格式，可在版本历史中还原'), (cause) => setError(cause instanceof Error ? cause.message : '保存失败'));
  }
  openEditRef.current = openEdit;
  askRef.current = () => { if (!busy && !activeReview) askAI(selection); };
  async function decide(review: ArtifactReview, ids: string[], decision: 'accept' | 'reject') {
    await act(async () => {
      const result = await api.decideArtifactReview(artifact.id, review.id, review.reviewVersion, ids, decision);
      const next = parseDocumentContent(result.artifact.content);
      if (next && result.artifact.version > version.current) {
        value.current = next; version.current = result.artifact.version;
        editor?.commands.setContent(next.doc, { emitUpdate: false });
        dropDocumentSelection(artifact.sessionId); setSelection(undefined);
      }
      artifacts.upsertArtifact(result.artifact); await refreshReviews();
    });
  }
  /** A long task is proposed in batches; accept them all in order (each follows the document as the one before lands). */
  async function acceptEverything() {
    await act(async () => {
      const pending = [...reviews].reverse().filter((review) => review.changes.some((change) => change.status === 'pending'));
      for (const review of pending) {
        const ids = review.changes.filter((change) => change.status === 'pending').map((change) => change.id);
        const result = await api.decideArtifactReview(artifact.id, review.id, review.reviewVersion, ids, 'accept');
        const next = parseDocumentContent(result.artifact.content);
        if (next && result.artifact.version > version.current) {
          value.current = next; version.current = result.artifact.version;
          editor?.commands.setContent(next.doc, { emitUpdate: false });
          dropDocumentSelection(artifact.sessionId); setSelection(undefined);
        }
        artifacts.upsertArtifact(result.artifact);
      }
      await refreshReviews();
    });
  }
  async function recover() {
    if (writing.current) await writing.current.catch((): void => { /* Error is shown by the save/review handler. */ });
    download(new Blob([JSON.stringify(value.current, null, 2)], { type: 'application/json' }), `${artifact.name}-恢复副本.json`);
    const latest = await api.getArtifact(artifact.id); const content = parseDocumentContent(latest.content); if (!content) throw new Error('文档格式无效');
    clearTimeout(timer.current); dirty.current = false; clearEditorRecovery(artifact.id);
    value.current = content; version.current = latest.version; editor?.commands.setContent(content.doc, { emitUpdate: false }); artifacts.upsertArtifact(latest); setError(''); setStatus('已保存');
  }
  const warnings = value.current.importWarnings ?? [];
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1" aria-label="文档格式">
      {activeReview
        ? <span className="flex items-center gap-1.5 px-1 text-xs text-ink-muted"><Sparkles className="size-3.5 text-accent" />正在审核 AI 修改，处理完后可继续编辑</span>
        : <FormatTools editor={editor} disabled={busy} />}
      <div className="ml-auto flex items-center gap-1 pl-2">
        <SaveStatus status={status} version={version.current} failed={Boolean(error)} />
        <Button size="icon-sm" variant="ghost" className="size-7" aria-label="文档版本历史" title="版本历史" disabled={busy} onClick={() => void act(async () => { setHistory(true); })}><History /></Button>
        <Button size="icon-sm" variant="ghost" className={cn('size-7', outlineOpen && 'bg-paper-inset text-ink')} aria-label="大纲" aria-pressed={outlineOpen} title="大纲" onClick={toggleOutline}><ListTree /></Button>
        <Button size="icon-sm" variant="ghost" className="size-7" aria-label="查找" title="查找和替换（Ctrl+F）" onClick={() => openFind(false)}><Search /></Button>
        <Button size="xs" variant="ghost" title="改写所选内容或光标所在段落（Ctrl+J）" disabled={busy || aiBusy || Boolean(activeReview) || Boolean(formatPreview)} onClick={openEdit}><PenLine data-icon="inline-start" />改写</Button>
        <Button size="xs" variant="ghost" title="检查全文一致性" disabled={busy || aiBusy || Boolean(activeReview)} onClick={() => void audit()}><ListChecks data-icon="inline-start" />检查</Button>
        <FormatMenu disabled={busy || aiBusy || Boolean(activeReview) || Boolean(formatPreview)} onPick={(spec) => void previewFormat(spec)} onPickReference={(file) => void previewReferenceFormat(file)} />
        <ExportMenu disabled={busy || Boolean(formatPreview)} canTrackChanges={Boolean(value.current.docx?.groups?.length)} onExport={(revisions) => void act(async () => { download(await api.exportDocument(artifact.id, { revisions }), `${artifact.name.replace(/\.docx$/i, '')}${revisions ? '（修订）' : ''}.docx`); })} />
      </div>
    </div>
    {formatPreview && <FormatPreviewBar name={formatPreview.name} result={formatPreview.result} view={formatPreview.view} onView={showFormatView} onApply={applyFormatPreview} onCancel={cancelFormat} />}
    {!activeReview && !formatPreview && <ReferenceStrip attached={referenced.length ? (pickedRanges.length ? `${pickedRanges.length} 段选区${pickedRanges.length === 1 ? `「${pickedRanges[0].selection.text ?? ''}」` : '，可在对话里用 [编号] 分别说明'}` : '全文') : undefined}
      hint={selection ? `已选 ${selection.text?.replace(/\n/g, '').length ?? 0} 字` : undefined}>
      <Button size="xs" variant="ghost" disabled={busy || !selection} title="把选中的文字加入对话，可多次添加（Ctrl+L）" onClick={() => askAI(selection)}><Quote data-icon="inline-start" />{pickedRanges.length ? '再加一段' : '引用选段'}</Button>
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => askAI(undefined)}>引用全文</Button>
    </ReferenceStrip>}
    {error && <Alert variant="destructive" className="rounded-none border-x-0 border-t-0"><AlertDescription>{error}<div className="mt-2 flex gap-2"><Button size="xs" variant="outline" onClick={() => void flush().catch((): void => { /* Error is shown by the save/review handler. */ })}>重试保存</Button><Button size="xs" variant="outline" onClick={() => void recover().catch((cause) => setError(String(cause)))}>下载恢复副本并重新载入</Button></div></AlertDescription></Alert>}
    <div className="flex min-h-0 flex-1">
    {outlineOpen && !activeReview && editor && <OutlinePanel editor={editor} scroller={scroller.current} />}
    <div ref={scroller} onPointerDown={() => { pointerDown.current = true; if (edit?.phase === 'input') closeEdit(false); }} onScroll={() => setBubble(null)} className={cn('relative min-h-0 min-w-0 flex-1 overflow-auto bg-paper-inset', activeReview && 'hidden')}>
      {find && editor && (
        <div className="sticky top-0 z-20 h-0">
          <FindBar key={find.nonce} editor={editor} scroller={scroller.current} replaceOpen={find.replace} initialQuery={find.initial}
            canReplace={!busy && !activeReview && !edit && !formatPreview && editor.isEditable}
            onToggleReplace={() => setFind({ ...find, replace: !find.replace })} onClose={closeFind} />
        </div>
      )}
      {warnings.length ? <details className="mx-auto mt-3 w-[calc(100%-1.5rem)] max-w-[816px] rounded-md border border-line bg-paper px-3 py-2 text-xs text-ink-muted">
        <summary className="cursor-pointer"><Info className="mr-1.5 inline size-3.5 align-[-2px]" />导入说明：{warnings.length} 处内容未完整保留</summary>
        {warnings.map((warning, i) => <p key={i} className="mt-1">{warning}</p>)}
        {value.current.originalArtifactId && <Button size="xs" variant="link" className="px-0" onClick={() => { void api.artifactRawUrl(value.current.originalArtifactId!).then((url) => { const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${artifact.name}-原始.docx`; anchor.click(); }); }}>下载原始文件</Button>}
      </details> : null}
      {/* Page: clicking the margin below the text puts the caret at the end, like a word processor. */}
      <div className="mx-auto my-3 w-[calc(100%-1.5rem)] max-w-[816px] rounded-sm border border-line bg-paper shadow-sm" onClick={(event) => { if (event.target === event.currentTarget) editor?.commands.focus('end'); }}>
        <EditorContent editor={editor} />
      </div>
      {bubble && selection && !busy && !edit && !formatPreview && (
        <div className="absolute z-20 -translate-x-1/2" style={{ top: bubble.top, left: bubble.left }} onMouseDown={(event) => event.preventDefault()}>
          <div className="pop-in flex h-8 items-stretch whitespace-nowrap rounded-[10px] bg-ink text-[12px] font-medium text-paper-raised shadow-[0_6px_20px_rgba(25,47,80,0.22)]">
            <button type="button" title="让 AI 直接改写所选内容" onClick={openEdit} className="flex items-center gap-1.5 rounded-l-[10px] pl-2.5 pr-2 transition-colors hover:bg-paper-raised/10">
              <PenLine className="size-3.5" />改写
              <kbd className="rounded-md bg-paper-raised/15 px-1.5 py-0.5 font-sans text-[11px] leading-none">{isMac ? '⌘J' : 'Ctrl J'}</kbd>
            </button>
            <span aria-hidden className="my-1.5 w-px bg-paper-raised/20" />
            <button type="button" title="把选中的内容加入对话，可多次添加" onClick={() => askAI(selection)} className="flex items-center gap-1.5 rounded-r-[10px] pl-2 pr-2.5 transition-colors hover:bg-paper-raised/10">
              <Sparkles className="size-3.5" />问 AI
              <kbd className="rounded-md bg-paper-raised/15 px-1.5 py-0.5 font-sans text-[11px] leading-none">{isMac ? '⌘L' : 'Ctrl L'}</kbd>
            </button>
          </div>
        </div>
      )}
      {edit && (
        <div className="absolute z-20" style={{ top: edit.at.top, left: edit.at.left }}>
          <InlineEditCard
            phase={edit.phase}
            notice={edit.notice}
            blocked={aiBusy && edit?.phase === 'input'}
            waiting={aiWaiting}
            onSubmit={(instruction) => void submitEdit(instruction)}
            onCancel={() => closeEdit()}
            onStop={() => { stopped.current = true; void chatStore.stopMessage(artifact.sessionId); }}
          />
        </div>
      )}
      <ReviewLog reviews={reviews} className="mx-auto mb-4 w-[calc(100%-1.5rem)] max-w-[816px]" />
    </div>
    </div>
    {activeReview && <DocumentReview key={activeReview.id} review={activeReview} regenerate={(review, change, feedback) => act(async () => { await api.regenerateReviewChange(artifact.id, review.id, change.id, review.reviewVersion, feedback); await refreshReviews(); })} otherBatches={pendingBatches - 1} acceptEverything={() => void acceptEverything()} busy={busy} decide={(review, ids, decision) => void decide(review, ids, decision)} revise={(review, change, text) => act(async () => {
      await api.reviseArtifactReview(artifact.id, review.id, change.id, review.reviewVersion, { ...(change.operation as object), text }); await refreshReviews();
    })} />}
    {history && <ArtifactHistoryDialog artifact={{ ...artifact, version: version.current }} close={() => setHistory(false)} flush={flush} getVersion={() => version.current} render={(content) => <DocumentReadOnly content={content} />} restored={async () => {
      const latest = await api.getArtifact(artifact.id); const content = parseDocumentContent(latest.content);
      if (!content) throw new Error('文档格式无效');
      value.current = content; version.current = latest.version; dirty.current = false;
      editor?.commands.setContent(content.doc, { emitUpdate: false }); dropDocumentSelection(artifact.sessionId); setSelection(undefined);
      artifacts.upsertArtifact(latest); await refreshReviews();
    }} />}
  </div>;
}
