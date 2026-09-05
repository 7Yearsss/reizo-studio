import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
// eslint-disable-next-line import/no-unresolved
import sheetsZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import { CommandType, createUniver, defaultTheme, LocaleType } from '@univerjs/presets';
import type { ArtifactRenderProps } from './types';
import {
  compactToUniverSnapshot,
  parseSheetContent,
  replaceUniverSnapshot,
  serializeSheetContent,
  type SheetArtifactContent,
} from '../../../../shared/sheetContent';
import { downloadSheetAsXlsx } from '../../../../shared/sheetXlsx';

import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/presets/lib/styles/preset-sheets-core.css';

type UniverAPI = {
  Event: { CommandExecuted: string; SelectionChanged: string; SelectionMoving: string };
  addEvent: (
    event: string,
    callback: (payload: { type?: number }) => void,
  ) => { dispose: () => void };
  createWorkbook: (data: Record<string, unknown>) => { save: () => unknown };
};

function disposeUniverLater(
  univer: { dispose: () => void } | null,
  host: HTMLElement | null,
): void {
  const instance = univer;
  window.setTimeout(() => {
    try {
      instance?.dispose();
    } catch {
      // ignore
    }
    if (!host?.isConnected) return;
    while (host.firstChild) {
      try {
        host.removeChild(host.firstChild);
      } catch {
        break;
      }
    }
  }, 0);
}

export default function SheetRenderer({
  artifact,
  text,
  onCommitDraft,
}: ArtifactRenderProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const parsedRef = useRef<SheetArtifactContent | null>(parseSheetContent(text));
  const workbookRef = useRef<{ save: () => unknown } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommitDraft);
  const hydratingRef = useRef(true);
  const dirtyRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    onCommitRef.current = onCommitDraft;
  }, [onCommitDraft]);

  const captureContent = useCallback((): string | null => {
    const current = parsedRef.current;
    const workbook = workbookRef.current;
    if (!current || !workbook) return null;
    try {
      const snapshot = workbook.save();
      const next = replaceUniverSnapshot(current, snapshot);
      parsedRef.current = next;
      return serializeSheetContent(next);
    } catch {
      return null;
    }
  }, []);

  const handleExport = useCallback(() => {
    const current = parsedRef.current;
    if (!current) return;
    void downloadSheetAsXlsx(current, artifact.name);
  }, [artifact.name]);

  useEffect(() => {
    const host = hostRef.current;
    const parsed = parseSheetContent(text);
    if (!host || !parsed) {
      setInitError('表格数据无法解析');
      return;
    }

    parsedRef.current = parsed;
    hydratingRef.current = true;
    dirtyRef.current = false;
    setReady(false);
    setInitError(null);

    let disposed = false;
    let univer: { dispose: () => void } | null = null;
    let commandSub: { dispose: () => void } | null = null;
    let hydrateTimer: ReturnType<typeof setTimeout> | null = null;
    let started = false;

    const start = () => {
      if (disposed) return;
      if (started) {
        window.dispatchEvent(new Event('resize'));
        return;
      }
      if (host.clientWidth < 80 || host.clientHeight < 240) return;
      started = true;

      try {
        const created = createUniver({
          locale: LocaleType.ZH_CN,
          locales: {
            [LocaleType.ZH_CN]: sheetsZhCN,
          },
          theme: defaultTheme,
          presets: [
            UniverSheetsCorePreset({
              container: host,
              header: true,
              toolbar: true,
              formulaBar: true,
              footer: { sheetBar: true, statisticBar: true, menus: true, zoomSlider: true },
            }),
          ],
        });
        univer = created.univer;
        const univerAPI = created.univerAPI as unknown as UniverAPI;
        const snapshot = (
          parsed.univerSnapshot && typeof parsed.univerSnapshot === 'object'
            ? parsed.univerSnapshot
            : compactToUniverSnapshot(parsed, artifact.name)
        ) as Record<string, unknown>;

        workbookRef.current = univerAPI.createWorkbook(snapshot);
        window.dispatchEvent(new Event('resize'));

        let hydrateDeadline: number | null = null;
        const scheduleHydrationComplete = () => {
          if (hydrateTimer) clearTimeout(hydrateTimer);
          if (hydrateDeadline == null) hydrateDeadline = Date.now() + 1200;
          const delay = Math.max(0, Math.min(150, hydrateDeadline - Date.now()));
          hydrateTimer = setTimeout(() => {
            hydratingRef.current = false;
            window.dispatchEvent(new Event('resize'));
            if (!disposed) setReady(true);
          }, delay);
        };

        commandSub = univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
          if (disposed) return;
          if (event.type !== CommandType.MUTATION) return;
          if (hydratingRef.current) {
            scheduleHydrationComplete();
            return;
          }
          dirtyRef.current = true;
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            if (!onCommitRef.current) return;
            const serialized = captureContent();
            if (!serialized) return;

            setSaveStatus('saving');
            void onCommitRef.current(serialized)
              .then(() => {
                setSaveStatus('saved');
                setTimeout(() => setSaveStatus('idle'), 2000);
              })
              .catch((err: unknown) => {
                setSaveStatus('error');
                setSaveErrorMessage(err instanceof Error ? err.message : '保存失败');
              });
          }, 600);
        });

        scheduleHydrationComplete();
      } catch (err) {
        setInitError(err instanceof Error ? err.message : '表格编辑器初始化失败');
      }
    };

    const startTimer = window.setTimeout(() => {
      const ro = new ResizeObserver(() => start());
      ro.observe(host);
      start();
      resizeObserver = ro;
    }, 0);

    let resizeObserver: ResizeObserver | null = null;

    return () => {
      disposed = true;
      workbookRef.current = null;
      window.clearTimeout(startTimer);
      if (hydrateTimer) clearTimeout(hydrateTimer);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      resizeObserver?.disconnect();
      commandSub?.dispose();
      disposeUniverLater(univer, host);
    };
  }, [artifact.id]);

  if (initError) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center p-6 text-center text-xs text-rose-500">
        <FileSpreadsheet className="mb-2 size-8 text-rose-400" />
        <p>{initError}</p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden bg-paper-raised">
      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-paper/80 text-xs text-ink-muted backdrop-blur-sm">
          <LoaderCircle className="size-4 animate-spin text-accent" />
          <span>正在打开表格…</span>
        </div>
      )}

      {/* Top right floating toolbar */}
      <div className="absolute right-3 top-2 z-20 flex items-center gap-2">
        {saveStatus === 'saving' && (
          <span className="text-[10px] text-ink-muted">保存中…</span>
        )}
        {saveStatus === 'saved' && (
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
            已保存
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-600 dark:text-rose-400">
            {saveErrorMessage || '保存失败'}
          </span>
        )}
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-paper/90 px-2 py-1 text-[11px] font-medium text-ink shadow-sm backdrop-blur hover:bg-paper"
          title="导出为原生 Excel (.xlsx) 文件"
        >
          <Download className="size-3" />
          <span>导出 Excel</span>
        </button>
      </div>

      <div ref={hostRef} className="h-full min-h-[420px] w-full flex-1" />
    </div>
  );
}
