import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, ListChecks, Table2 } from 'lucide-react';
import type { Artifact, ArtifactWithContent } from '../../../shared/artifact';
import type { ArtifactReview } from '../../../shared/artifactReview';
import { parseSheetContent, serializeSheetContent, type SheetArtifactContent } from '../../../shared/sheetContent';
import { buildSheetDiffPreview, diffSheetContent, sheetImpacts } from '../../../shared/sheetReview';
import * as api from '../../api';
import * as artifactStore from '../../state/artifactStore';
import * as chatStore from '../../state/chatStore';
import { serializeSheetReference } from '../../../shared/sheetReferences';
import { clearSheetRecovery, discardWorkbookEdits, flushWorkbookEdits, getSheetRecovery, setSheetRecovery, trackSheetWrite, useSheetWorkspace, pinSheetSelection } from '../../state/sheetWorkspace';
import { createDeferredView } from '../DeferredView';
import type { SheetCellFocus, SheetRendererProps } from './renderers/SheetRenderer';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { toast } from '../../lib/toast';
import ArtifactVersionRail from './ArtifactVersionRail';
import { focusComposer } from './workspaceChrome';
import SheetReview, { type SheetSelectedCell } from './SheetReview';
import SheetPivotPanel from './SheetPivotPanel';
import SheetAuditPanel from './SheetAuditPanel';
import SheetChartDock from './SheetChartView';
import { applySheetChart, removeSheetChart, sheetCharts } from '../../../shared/sheetChart';

const Editor = createDeferredView<SheetRendererProps>(() => import('./renderers/SheetRenderer'), { label: 'Excel 编辑器', minHeight: 420 });
interface Frame { doc: ArtifactWithContent; generation: number; recovered: boolean; error?: string }

export default function SheetDocument({ artifact }: { artifact: Artifact; onClose?(): void }) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const current = useRef<ArtifactWithContent | null>(null);
  const sequence = useRef(0);
  const [viewVersion, setViewVersion] = useState<number | undefined>();
  const [showHistory, setShowHistory] = useState(false);
  const [showPivots, setShowPivots] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [liveContent, setLiveContent] = useState<SheetArtifactContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const activeSelection = useSheetWorkspace((s) => s.activeBySession[artifact.sessionId]);
  const ownSelection = activeSelection?.artifactId === artifact.id ? activeSelection : undefined;
  const [reviews, setReviews] = useState<ArtifactReview[]>([]);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [selectedCell, setSelectedCell] = useState<SheetSelectedCell>();
  const [focus, setFocus] = useState<SheetCellFocus>();
  const focusRequest = useSheetWorkspace((s) => s.focusBySession[artifact.sessionId]);
  const reviewRevision = useSheetWorkspace((s) => s.reviewRevisions[artifact.id] ?? 0);

  useEffect(() => {
    let cancelled = false;
    void api.listArtifactReviews(artifact.id).then((next) => { if (!cancelled) setReviews(next); }, (cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : '修改建议加载失败'); });
    return () => { cancelled = true; };
  }, [artifact.id, artifact.version, reviewRevision]);

  const activeReview = reviews.find((review) => review.changes.some((change) => change.status === 'pending'));
  const reviewPreview = useMemo(() => {
    if (!activeReview) return null;
    const base = parseSheetContent(activeReview.baseContent);
    const candidate = parseSheetContent(activeReview.candidateContent);
    if (!base || !candidate) return null;
    const diff = diffSheetContent(base, candidate);
    return { diff, candidate, text: serializeSheetContent({ ...candidate, univerSnapshot: buildSheetDiffPreview(base, candidate, diff, artifact.name) }) };
  }, [activeReview?.id, activeReview?.reviewVersion, artifact.name]);
  const previewing = Boolean(reviewPreview && !showOriginal && !viewVersion);
  // The preview editor calculates the candidate; compare it with what the saved workbook showed.
  const impacts = useMemo(() => {
    const base = activeReview ? parseSheetContent(activeReview.baseContent) : null;
    return previewing && reviewPreview && base && liveContent ? sheetImpacts(base, liveContent, reviewPreview.diff) : [];
  }, [previewing, reviewPreview, activeReview?.baseContent, liveContent]);
  useEffect(() => { setLiveContent(null); }, [frame?.generation, previewing, viewVersion]);

  async function decide(review: ArtifactReview, ids: string[], decision: 'accept' | 'reject') {
    setReviewBusy(true);
    try {
      await flushWorkbookEdits(artifact.id);
      const result = await api.decideArtifactReview(artifact.id, review.id, review.reviewVersion, ids, decision);
      if (result.artifact) artifactStore.upsertArtifact(result.artifact);
      setSelectedCell(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '审核失败'); }
    finally { setReviews(await api.listArtifactReviews(artifact.id).catch(() => reviews)); setReviewBusy(false); }
  }

  /** Saves a direct (non-agent) structural change such as a pivot, then reloads the editor from it. */
  async function commitContent(mutate: (content: SheetArtifactContent) => SheetArtifactContent): Promise<boolean> {
    setReviewBusy(true);
    try {
      await flushWorkbookEdits(artifact.id);
      const base = current.current;
      const parsed = base ? parseSheetContent(base.content) : null;
      if (!base || !parsed) throw new Error('表格尚未加载');
      const saved = await api.addArtifactVersion(base.id, serializeSheetContent(mutate(parsed)), base.version);
      artifactStore.upsertArtifact(saved);
      current.current = null;
      setReload((n) => n + 1);
      setError(null);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); return false; }
    finally { setReviewBusy(false); }
  }

  useEffect(() => {
    if (!viewVersion && current.current?.id === artifact.id && current.current.version >= artifact.version && frame) return;
    let cancelled = false;
    void (async () => {
      await flushWorkbookEdits(artifact.id);
      const doc = await api.getArtifact(artifact.id, viewVersion);
      if (cancelled) return;
      const draft = !viewVersion ? getSheetRecovery(artifact.id) : undefined;
      const effective = draft ? { ...doc, content: draft.content, version: draft.expectedVersion } : doc;
      current.current = effective;
      setFrame({ doc: effective, generation: ++sequence.current, recovered: Boolean(draft), error: draft?.error });
      setError(draft?.error ?? null);
    })().catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : '表格加载失败'); });
    return () => { cancelled = true; };
  }, [artifact.id, artifact.version, viewVersion, reload]);

  const save = useCallback(async (content: string) => {
    const base = current.current;
    if (!base) throw new Error('表格尚未加载');
    setSheetRecovery(base.id, { sessionId: base.sessionId, content, expectedVersion: base.version });
    try {
      const saved = await trackSheetWrite(base.sessionId, api.addArtifactVersion(base.id, content, base.version));
      current.current = saved;
      clearSheetRecovery(base.id);
      setFrame((previous) => previous ? { ...previous, doc: saved } : previous);
      setError(null);
      artifactStore.upsertArtifact(saved);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '表格保存失败';
      setSheetRecovery(base.id, { sessionId: base.sessionId, content, expectedVersion: base.version, error: message });
      setError(message);
      throw cause;
    }
  }, []);

  async function discardAndReload() {
    await discardWorkbookEdits(artifact.id);
    current.current = null;
    setViewVersion(undefined);
    setReload((n) => n + 1);
  }
  async function pickVersion(version: number) {
    try { await flushWorkbookEdits(artifact.id); setViewVersion(version); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '请先保存表格'); }
  }
  /** Quote the selected range: it is numbered in the composer and a [n] chip lands at the caret. */
  function quoteSelection() {
    if (!ownSelection?.range || !pinSheetSelection(artifact.sessionId)) return;
    focusComposer(artifact.sessionId, { cite: true });
  }
  /** Hand the audit to the agent: it runs check_sheet and proposes the fixes for review. */
  async function askFix() {
    try {
      await flushWorkbookEdits(artifact.id);
      void chatStore.sendMessage(artifact.sessionId, '检查这份表格（错误值、与同列不一致的公式、公式列里混入的手写数值、汇总范围漏掉的数据、文本型数字、多余空格），并给出可逐条审核的修改建议', [serializeSheetReference({ artifactId: artifact.id })]);
      focusComposer(artifact.sessionId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '请先保存表格'); }
  }
  const content = frame ? parseSheetContent(frame.doc.content) : null;
  // A reply pointed at a cell ("Sheet1!C5"): scroll the open workbook there.
  useEffect(() => {
    if (!focusRequest || !content) return;
    const sheet = content.sheets.find((s) => s.name === focusRequest.sheetName) ?? content.sheets.find((s) => s.name.toLowerCase() === focusRequest.sheetName.toLowerCase());
    if (!sheet) { toast.info(`当前打开的表格里没有工作表「${focusRequest.sheetName}」`); return; }
    setFocus({ sheetId: sheet.id, range: focusRequest.range, nonce: focusRequest.nonce });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce, Boolean(content)]);
  // Charts read formula results from the live workbook; stored content may predate the last calculation.
  const chartContent = liveContent ?? (previewing ? reviewPreview?.candidate : content) ?? null;
  const charts = previewing && reviewPreview ? [...sheetCharts(reviewPreview.candidate), ...(content ? sheetCharts(content).filter((c) => reviewPreview.diff.charts.some((d) => d.id === c.id && d.status === 'removed')) : [])] : content ? sheetCharts(content) : [];
  const chartStatuses = previewing && reviewPreview ? Object.fromEntries(reviewPreview.diff.charts.map((c) => [c.id, c.status])) : undefined;
  const truncated = content?.importMeta && (content.importMeta.truncatedRows || content.importMeta.truncatedCols || content.importMeta.truncatedSheets);
  const toolbar = <>
    {viewVersion && <Button variant="ghost" size="sm" onClick={() => { current.current = null; setViewVersion(undefined); }}>返回最新</Button>}
    {!viewVersion && <Button variant={showAudit ? 'secondary' : 'ghost'} size="icon-sm" aria-label="检查" disabled={previewing} title={previewing ? '请先处理或切到原表' : '检查错误值、不一致的公式、文本型数字等'} onClick={() => { setShowAudit((v) => !v); setShowPivots(false); }}><ListChecks /></Button>}
    {!viewVersion && <Button variant={showPivots ? 'secondary' : 'ghost'} size="icon-sm" aria-label="透视表" disabled={previewing} title={previewing ? '请先处理或切到原表' : '新建或调整透视表'} onClick={() => { setShowPivots((v) => !v); setShowAudit(false); }}><Table2 /></Button>}
    <Button variant="ghost" size="icon-sm" aria-label="表格版本历史" title={`版本历史 · 当前 v${frame?.doc.version ?? artifact.version}`} onClick={() => setShowHistory((v) => !v)}><History /></Button>
  </>;
  return <div className="flex min-h-0 flex-1 flex-col" onKeyDownCapture={(event) => { if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'l') { event.preventDefault(); quoteSelection(); } }}>
    {error && <Alert variant="destructive"><AlertDescription>{error}<Button variant="outline" size="sm" onClick={() => void discardAndReload()}>丢弃未保存编辑并重新加载</Button></AlertDescription></Alert>}
    {truncated && <Alert><AlertDescription>文件超过当前表格容量，已导入部分内容；原文件未被修改。最多 8 张工作表、2000 行、50 列和 40000 个单元格。</AlertDescription></Alert>}
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        {frame && previewing && reviewPreview && activeReview ? <Editor key={`preview:${activeReview.id}:${activeReview.reviewVersion}`} artifact={frame.doc} version={frame.doc.version} text={reviewPreview.text} rawUrl="" readOnlyLabel="修改预览 · 只读，接受后写入" onSelectCell={setSelectedCell} focus={focus} onLiveContent={setLiveContent} toolbar={toolbar} />
          : frame ? <Editor key={`${artifact.id}:${frame.generation}`} artifact={frame.doc} version={frame.doc.version} text={frame.doc.content} rawUrl="" onCommitDraft={!viewVersion ? save : undefined} initialDirty={frame.recovered} initialError={frame.error} focus={focus} onLiveContent={setLiveContent} toolbar={toolbar} /> : <p role="status" className="p-4 text-xs text-ink-muted">正在加载表格…</p>}
        {chartContent && <SheetChartDock content={chartContent} charts={charts} statuses={chartStatuses} busy={reviewBusy}
          selection={!previewing && !viewVersion ? ownSelection : undefined}
          onChangeType={!previewing && !viewVersion ? (chart, type) => void commitContent((latest) => applySheetChart(latest, { id: chart.id, type }).content) : undefined}
          onDelete={!previewing && !viewVersion ? (chart) => void commitContent((latest) => removeSheetChart(latest, chart.id)) : undefined}
          onCreateFromSelection={!previewing && !viewVersion && ownSelection?.range ? () => void commitContent((latest) => applySheetChart(latest, { source: { sheet: ownSelection.sheetId, range: ownSelection.range! } }).content) : undefined} />}
      </div>
      {activeReview && !viewVersion && <SheetReview reviews={reviews} totalDiff={reviewPreview?.diff ?? null} impacts={impacts} busy={reviewBusy} previewing={previewing} selected={selectedCell} onTogglePreview={() => setShowOriginal((v) => !v)} onFocus={(target) => { setShowOriginal(false); setFocus({ ...target, nonce: Date.now() }); }} decide={(review, ids, decision) => void decide(review, ids, decision)} />}
      {showAudit && !viewVersion && !previewing && (liveContent ?? content) && <SheetAuditPanel content={(liveContent ?? content)!} busy={reviewBusy} onFocus={(target) => setFocus({ ...target, nonce: Date.now() })} onFix={() => void askFix()} onClose={() => setShowAudit(false)} />}
      {showPivots && !viewVersion && !previewing && content && <SheetPivotPanel content={content} selection={ownSelection} busy={reviewBusy} commit={commitContent} onClose={() => setShowPivots(false)} />}
      {showHistory && <ArtifactVersionRail artifactId={artifact.id} activeVersion={frame?.doc.version ?? artifact.version} onPick={(n) => void pickVersion(n)} onBeforeRestore={() => flushWorkbookEdits(artifact.id)} onRestored={() => { current.current = null; setViewVersion(undefined); setReload((n) => n + 1); void artifactStore.loadSessionArtifacts(artifact.sessionId); }} />}
    </div>
  </div>;
}
