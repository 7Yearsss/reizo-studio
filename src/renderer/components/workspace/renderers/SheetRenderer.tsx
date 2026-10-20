import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, LoaderCircle } from 'lucide-react';
import { CalculationMode, UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
// eslint-disable-next-line import/no-unresolved
import sheetsZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import { CommandType, createUniver, defaultTheme, LocaleType } from '@univerjs/presets';

// Univer 0.25 asks for `sheets-ui.info.*` when a typed number is stored as text, but ships those strings under
// `sheets-numfmt-ui`, so the hint over such cells showed raw keys. Mirror them where they are looked up.
const sheetsUi = (sheetsZhCN as Record<string, { info?: Record<string, string> } | undefined>)['sheets-ui'];
const zhCNLocale = { ...sheetsZhCN, 'sheets-ui': { ...sheetsUi, info: { ...sheetsUi?.info, error: '提示', forceStringInfo: '以文本形式存储的数字' } } };
import type { ArtifactRenderProps } from './types';
import { useShellSlot } from '../workspaceChrome';
import { compactToUniverSnapshot, parseSheetContent, replaceUniverSnapshot, serializeSheetContent, type SheetArtifactContent } from '../../../../shared/sheetContent';
import { clearActiveSheet, publishSheetSelection, registerSheetFlusher } from '../../../state/sheetWorkspace';
import { useChatStore } from '../../../state/useChatStore';
import { Button } from '../../ui/button';
import { Alert, AlertDescription } from '../../ui/alert';
import { toast } from '../../../lib/toast';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/presets/lib/styles/preset-sheets-core.css';

type Workbook = { save(): unknown; setEditable(value: boolean): Workbook; isCellEditing(): boolean; endEditingAsync(save?: boolean): Promise<boolean> };
type SelectionEvent = { type?: number; worksheet?: { getSheetId(): string; getSheetName(): string; getRange(range: unknown): { getA1Notation(): string } }; selections?: unknown[] };
type FacadeSheet = { activate(): unknown; getRange(a1: string): { activate(): unknown } };
type UniverAPI = {
  getFormula(): { onCalculationResultApplied(timeout?: number): Promise<void> };
  toggleDarkMode(isDarkMode: boolean): void;
  Event: { CommandExecuted: string; SelectionChanged: string; SelectionMoving: string };
  addEvent(event: string, listener: (payload: SelectionEvent) => void): { dispose(): void };
  createWorkbook(data: Record<string, unknown>): Workbook;
  getActiveWorkbook(): { getSheetBySheetId(id: string): FacadeSheet | null } | null;
};
export interface SheetCellFocus { sheetId: string; range: string; nonce: number }
export interface SheetRendererProps extends ArtifactRenderProps {
  initialDirty?: boolean;
  initialError?: string;
  /** Read-only caption shown instead of the history-version label. */
  readOnlyLabel?: string;
  onSelectCell?(cell: { sheetId: string; row: number; col: number }): void;
  focus?: SheetCellFocus;
  /** Actions shown in the editor's own bar, so the workbook has one header row instead of two. */
  toolbar?: ReactNode;
  /** Workbook content with current formula results, emitted after load and after edits settle (for charts). */
  onLiveContent?(content: SheetArtifactContent): void;
}

export default function SheetRenderer({ artifact, text, onCommitDraft, initialDirty = false, initialError, readOnlyLabel, onSelectCell, focus, onLiveContent, toolbar }: SheetRendererProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const workbookRef = useRef<Workbook | null>(null);
  const formulaRef = useRef<ReturnType<UniverAPI['getFormula']> | null>(null);
  const parsedRef = useRef(parseSheetContent(text));
  const saveCallback = useRef(onCommitDraft);
  saveCallback.current = onCommitDraft;
  const selectCallback = useRef(onSelectCell);
  selectCallback.current = onSelectCell;
  const liveCallback = useRef(onLiveContent);
  liveCallback.current = onLiveContent;
  const shellSlot = useShellSlot();
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitLive = useCallback(() => {
    if (!liveCallback.current) return;
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => {
      void (formulaRef.current?.onCalculationResultApplied(3000) ?? Promise.resolve()).catch((): void => undefined).then(() => {
        const workbook = workbookRef.current;
        if (!workbook || !parsedRef.current) return;
        try { liveCallback.current?.(replaceUniverSnapshot(parsedRef.current, workbook.save())); } catch { /* Disposed mid-flight. */ }
      });
    }, 400);
  }, []);
  const apiRef = useRef<UniverAPI | null>(null);
  const dirty = useRef(initialDirty);
  const discarded = useRef(false);
  const editSequence = useRef(0);
  const pendingSave = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrating = useRef(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const busy = useChatStore((s) => s.sendingBySession[artifact.sessionId]) ?? false;
  const blocked = busy || !onCommitDraft || !ready;
  useEffect(() => { workbookRef.current?.setEditable(!blocked); }, [blocked]);

  const capture = useCallback(() => {
    if (!parsedRef.current || !workbookRef.current) throw new Error('表格尚未就绪');
    const content = replaceUniverSnapshot(parsedRef.current, workbookRef.current.save());
    parsedRef.current = content;
    return serializeSheetContent(content);
  }, []);

  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const flush = useCallback(async () => {
    if (!saveCallback.current || discarded.current) return;
    if (pendingSave.current) { await pendingSave.current; return flushRef.current(); }
    // Own the entire flush before the first await, including cell-editor and formula commits.
    const pending = Promise.resolve().then(async () => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      const workbook = workbookRef.current;
      if (workbook?.isCellEditing()) {
        if (!await workbook.endEditingAsync(true)) throw new Error('请先完成当前单元格输入');
        dirty.current = true;
        editSequence.current++;
      }
      if (!dirty.current || discarded.current) return;
      if (hydrating.current) throw new Error('表格正在加载，请稍后再发送');
      await formulaRef.current?.onCalculationResultApplied(5000);
      if (discarded.current) return;
      const sequence = editSequence.current;
      const content = capture();
      setSaving(true);
      await saveCallback.current?.(content);
      dirty.current = editSequence.current !== sequence;
      setError(null);
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : '表格保存失败');
      throw cause;
    }).finally(() => { pendingSave.current = null; setSaving(false); });
    pendingSave.current = pending;
    await pending;
    if (dirty.current) await flushRef.current();
  }, [capture]);
  flushRef.current = flush;

  useEffect(() => onCommitDraft ? registerSheetFlusher(artifact.sessionId, artifact.id, () => flushRef.current(), async () => {
    discarded.current = true;
    dirty.current = false;
    await pendingSave.current?.catch((): void => undefined);
  }) : undefined, [artifact.id, artifact.sessionId, Boolean(onCommitDraft)]);

  useEffect(() => {
    const host = hostRef.current;
    const parsed = parseSheetContent(text);
    if (!host || !parsed) { setInitError('表格数据无法解析'); return; }
    parsedRef.current = parsed;
    const engineHost = document.createElement('div');
    engineHost.style.cssText = 'height:100%;width:100%;min-height:420px';
    host.appendChild(engineHost);
    let disposed = false;
    let started = false;
    let univer: { dispose(): void } | undefined;
    let api: UniverAPI | undefined;
    const subscriptions: { dispose(): void }[] = [];
    let hydrationTimer: ReturnType<typeof setTimeout> | undefined;
    let hydrationDeadline = 0;
    const finishHydration = () => {
      if (!hydrationDeadline) hydrationDeadline = Date.now() + 1200;
      clearTimeout(hydrationTimer);
      hydrationTimer = setTimeout(() => {
        hydrating.current = false;
        if (!disposed) { setReady(true); emitLive(); }
        window.dispatchEvent(new Event('resize'));
      }, Math.max(0, Math.min(150, hydrationDeadline - Date.now())));
    };
    const start = () => {
      if (disposed || host.clientWidth < 80 || host.clientHeight < 240) return;
      if (started) { window.dispatchEvent(new Event('resize')); return; }
      started = true;
      try {
        const created = createUniver({ locale: LocaleType.ZH_CN, locales: { [LocaleType.ZH_CN]: zhCNLocale }, theme: defaultTheme, darkMode: document.documentElement.classList.contains('dark'),
          presets: [UniverSheetsCorePreset({ container: engineHost, header: true, toolbar: true, formulaBar: true, formula: { initialFormulaComputing: CalculationMode.FORCED }, footer: { sheetBar: true, statisticBar: true, menus: true, zoomSlider: true } })] });
        univer = created.univer;
        api = created.univerAPI as unknown as UniverAPI;
        apiRef.current = api;
        formulaRef.current = api.getFormula();
        workbookRef.current = api.createWorkbook((parsed.univerSnapshot ?? compactToUniverSnapshot(parsed, artifact.name)) as Record<string, unknown>);
        workbookRef.current.setEditable(Boolean(saveCallback.current) && !busy);
        subscriptions.push(api.addEvent(api.Event.CommandExecuted, (event) => {
          if (!disposed && !hydrating.current && event.type === CommandType.MUTATION) emitLive();
          if (disposed || event.type !== CommandType.MUTATION || !saveCallback.current) return;
          if (hydrating.current) { finishHydration(); return; }
          dirty.current = true;
          editSequence.current++;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => { void flushRef.current().catch((): void => undefined); }, 600);
        }));
        const select = (event: SelectionEvent) => {
          if (disposed || hydrating.current) return;
          const worksheet = event.worksheet;
          const range = event.selections?.[0];
          if (!worksheet || !range) return;
          const start = range as { startRow?: number; startColumn?: number };
          if (typeof start.startRow === 'number' && typeof start.startColumn === 'number') selectCallback.current?.({ sheetId: worksheet.getSheetId(), row: start.startRow, col: start.startColumn });
          if (!saveCallback.current) return;
          publishSheetSelection(artifact.sessionId, { artifactId: artifact.id, name: artifact.name, sheetId: worksheet.getSheetId(), sheetName: worksheet.getSheetName(), range: worksheet.getRange(range).getA1Notation() });
        };
        subscriptions.push(api.addEvent(api.Event.SelectionChanged, select), api.addEvent(api.Event.SelectionMoving, select));
        if (saveCallback.current) publishSheetSelection(artifact.sessionId, { artifactId: artifact.id, name: artifact.name });
        finishHydration();
      } catch (cause) { setInitError(cause instanceof Error ? cause.message : '表格初始化失败'); }
    };
    const observer = new ResizeObserver(start);
    let lastDarkMode = document.documentElement.classList.contains('dark');
    const themeObserver = new MutationObserver(() => {
      const nextDarkMode = document.documentElement.classList.contains('dark');
      if (nextDarkMode === lastDarkMode) return;
      lastDarkMode = nextDarkMode;
      api?.toggleDarkMode(nextDarkMode);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    observer.observe(host);
    const startTimer = setTimeout(start, 0);
    return () => {
      disposed = true;
      clearTimeout(startTimer);
      clearTimeout(hydrationTimer);
      if (timer.current) clearTimeout(timer.current);
      if (liveTimer.current) clearTimeout(liveTimer.current);
      observer.disconnect();
      themeObserver.disconnect();
      clearActiveSheet(artifact.sessionId, artifact.id);
      // Finish the edit before disposing the editor's independent React root.
      void flushRef.current().catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : '表格未保存')).finally(() => {
        subscriptions.forEach((s) => s.dispose());
        workbookRef.current = null;
        formulaRef.current = null;
        apiRef.current = null;
        setTimeout(() => { univer?.dispose(); engineHost.remove(); }, 0);
      });
    };
  }, [artifact.id]);

  useEffect(() => {
    if (!focus || !ready) return;
    try {
      const sheet = apiRef.current?.getActiveWorkbook()?.getSheetBySheetId(focus.sheetId);
      sheet?.activate();
      sheet?.getRange(focus.range).activate();
    } catch { /* A sheet removed by the review has nothing to focus. */ }
  }, [focus, ready]);

  async function download() {
    setExporting(true);
    try {
      await flushRef.current();
      await formulaRef.current?.onCalculationResultApplied(5000);
      const current = parseSheetContent(capture());
      if (current) await (await import('../../../../shared/sheetXlsx')).downloadSheetAsXlsx(current, artifact.name);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导出失败'); }
    finally { setExporting(false); }
  }

  const status = saving ? '正在保存…' : busy ? 'Agent 正在处理，暂时只读' : onCommitDraft ? '' : readOnlyLabel ?? '历史版本 · 只读';
  const actions = <>
    {status && <span role="status" className="mr-1 max-w-[9rem] truncate text-xs text-ink-muted" title={status}>{status}</span>}
    {toolbar}
    <Button variant="ghost" size="icon-sm" aria-label="导出 Excel" title={exporting ? '正在导出…' : '导出 Excel'} onClick={() => void download()} disabled={!ready || saving || exporting}>{exporting ? <LoaderCircle className="animate-spin" /> : <Download />}</Button>
  </>;
  if (initError) return <Alert variant="destructive"><AlertDescription>{initError}</AlertDescription></Alert>;
  return <div className="relative flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden bg-paper-raised">
    {shellSlot ? createPortal(actions, shellSlot) : <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1">{actions}</div>}
    {error && <Alert variant="destructive"><AlertDescription>{error}<Button variant="outline" size="sm" onClick={() => void flushRef.current().catch((): void => undefined)}>重试保存</Button></AlertDescription></Alert>}
    {!ready && <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-paper/90"><LoaderCircle className="size-4 animate-spin" />正在打开表格…</div>}
    <div ref={hostRef} inert={blocked} aria-readonly={blocked} className="min-h-[420px] w-full flex-1" />
  </div>;
}
