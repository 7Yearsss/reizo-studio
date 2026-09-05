import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, LoaderCircle, RefreshCw } from 'lucide-react';
import type { ExcalidrawInitialDataState, ExcalidrawProps } from '@excalidraw/excalidraw/types';
import type { ArtifactRenderProps } from './types';
import {
  mergeCanvasElements,
  needsCanvasConversion,
  parseCanvasContent,
  sanitizeCanvasAppState,
  serializeCanvasContent,
  type CanvasArtifactContent,
  type CanvasElement,
} from '../../../../shared/canvasContent';

// eslint-disable-next-line import/no-unresolved
import '@excalidraw/excalidraw/index.css';

const Excalidraw = React.lazy(async () => {
  const mod = await import('@excalidraw/excalidraw');
  return { default: mod.Excalidraw };
});

async function convertMermaidToElements(mermaid: string): Promise<CanvasElement[]> {
  const [{ parseMermaidToExcalidraw }, { convertToExcalidrawElements }] = await Promise.all([
    import('@excalidraw/mermaid-to-excalidraw'),
    import('@excalidraw/excalidraw'),
  ]);
  const { elements: skeletonElements } = await parseMermaidToExcalidraw(mermaid);
  return convertToExcalidrawElements(skeletonElements) as unknown as CanvasElement[];
}

export default function DiagramRenderer({
  artifact,
  text,
  onCommitDraft,
}: ArtifactRenderProps) {
  const [parsed, setParsed] = useState<CanvasArtifactContent | null>(() => parseCanvasContent(text));
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedRef = useRef<CanvasArtifactContent | null>(parsed);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommitDraft);

  useEffect(() => {
    onCommitRef.current = onCommitDraft;
  }, [onCommitDraft]);

  // Sync state when external text changes
  useEffect(() => {
    const next = parseCanvasContent(text);
    setParsed(next);
    parsedRef.current = next;
    setError(null);
  }, [text]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // Perform Mermaid -> Excalidraw conversion if needed
  useEffect(() => {
    if (!parsed || !needsCanvasConversion(parsed)) return;

    let cancelled = false;
    setConverting(true);
    setError(null);

    void (async () => {
      try {
        const freshElements = await convertMermaidToElements(parsed.mermaidSource);
        if (cancelled) return;

        const next: CanvasArtifactContent = {
          mermaidSource: parsed.mermaidSource,
          convertedFromMermaid: parsed.mermaidSource,
          scene: {
            elements: mergeCanvasElements(parsed.scene?.elements ?? [], freshElements),
            appState: sanitizeCanvasAppState(parsed.scene?.appState),
          },
        };

        parsedRef.current = next;
        setParsed(next);
        setConverting(false);

        // Auto-save the converted scene so next view is instant
        if (onCommitRef.current) {
          void onCommitRef.current(serializeCanvasContent(next));
        }
      } catch (err) {
        if (cancelled) return;
        setConverting(false);
        setError(err instanceof Error ? err.message : 'Mermaid 图表解析失败');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [parsed?.mermaidSource, parsed?.convertedFromMermaid]);

  const handleChange = useCallback<NonNullable<ExcalidrawProps['onChange']>>(
    (elements, appState) => {
      const current = parsedRef.current;
      if (!current) return;

      const next: CanvasArtifactContent = {
        ...current,
        scene: {
          elements: [...elements] as unknown as CanvasElement[],
          appState: sanitizeCanvasAppState(appState),
        },
      };
      parsedRef.current = next;

      if (!onCommitRef.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        if (onCommitRef.current) {
          void onCommitRef.current(serializeCanvasContent(next));
        }
      }, 800);
    },
    [],
  );

  const initialData = useMemo<ExcalidrawInitialDataState | null>(() => {
    if (!parsed?.scene) return null;
    return {
      elements: parsed.scene.elements as unknown as ExcalidrawInitialDataState['elements'],
      appState: sanitizeCanvasAppState(parsed.scene.appState) as ExcalidrawInitialDataState['appState'],
    };
  }, [parsed]);

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const downloadJson = useCallback(() => {
    if (!parsed) return;
    const blob = new Blob([serializeCanvasContent(parsed)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.name.replace(/\.[^.]+$/, '')}.excalidraw.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [artifact.name, parsed]);

  if (error) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="size-8 text-rose-500" />
        <div className="max-w-md space-y-1">
          <p className="text-sm font-medium text-ink">流程图生成失败</p>
          <p className="text-xs text-ink-muted">{error}</p>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConverting(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
          >
            <RefreshCw className="size-3.5" />
            重试转绘
          </button>
        </div>
      </div>
    );
  }

  if (converting || !initialData) {
    return (
      <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-2 p-8 text-xs text-ink-muted">
        <LoaderCircle className="size-5 animate-spin text-accent" />
        <span>正在渲染流程图画布…</span>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[380px] min-w-0 flex-1 flex-col overflow-hidden bg-paper-raised">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <button
          type="button"
          onClick={downloadJson}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-paper/90 px-2 py-1 text-[11px] font-medium text-ink shadow-sm backdrop-blur hover:bg-paper"
          title="导出为 Excalidraw 文件"
        >
          <Download className="size-3" />
          <span>导出文件</span>
        </button>
      </div>
      <React.Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-xs text-ink-muted">
            <LoaderCircle className="size-4 animate-spin text-accent" />
          </div>
        }
      >
        <Excalidraw
          key={`${artifact.id}:${parsed.convertedFromMermaid ?? 'unconverted'}`}
          initialData={initialData}
          onChange={handleChange}
          theme={isDark ? 'dark' : 'light'}
        />
      </React.Suspense>
    </div>
  );
}
