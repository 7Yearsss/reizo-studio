import { useEffect, useState, type ReactElement } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import type { TurnTrace } from '../../../main/server/agent/turnTrace';
import { formatMs, traceBars, turnLanes } from '../../../shared/traceView';
import * as api from '../../api';
import { cn } from '../../lib/cn';

/** "查看运行记录": each recorded turn of a conversation with its tool calls laid out on a time bar, failures spelled out. */
export default function TraceDialog(): ReactElement {
  const [target, setTarget] = useState<{ id: string; title: string } | null>(null);
  const [traces, setTraces] = useState<TurnTrace[] | null>(null);

  useEffect(() => {
    const open = (event: Event): void => setTarget((event as CustomEvent<{ id: string; title: string }>).detail);
    window.addEventListener('reizo:open-trace', open);
    return (): void => window.removeEventListener('reizo:open-trace', open);
  }, []);

  useEffect(() => {
    if (!target) { setTraces(null); return; }
    let cancelled = false;
    void api.getSessionTraces(target.id).then(
      (list) => { if (!cancelled) setTraces(list); },
      (): void => { if (!cancelled) setTraces([]); },
    );
    return (): void => { cancelled = true; };
  }, [target]);

  return (
    <Dialog.Root open={target !== null} onOpenChange={(open) => { if (!open) setTarget(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[min(820px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-hidden rounded-2xl border border-line bg-paper-raised p-5 shadow-2xl outline-none">
          <div className="flex items-center">
            <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold">运行记录 · {target?.title}</Dialog.Title>
            <Dialog.Close className="rounded p-1 text-ink-muted hover:text-ink" aria-label="关闭"><X size={16} /></Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">这个对话每次回复的耗时与工具调用</Dialog.Description>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {traces === null ? (
              <p className="text-sm text-ink-muted">加载中…</p>
            ) : traces.length === 0 ? (
              <p className="text-sm text-ink-muted">这个对话还没有运行记录</p>
            ) : (
              [...traces].reverse().map((trace, i) => <TurnRow key={`${trace.at}-${i}`} trace={trace} />)
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TurnRow({ trace }: { trace: TurnTrace }): ReactElement {
  const bars = traceBars(trace.durationMs, trace.toolTimeline, trace.tools);
  const failed = trace.tools.filter((t) => !t.ok);
  const lanes = turnLanes(trace.durationMs, trace.toolTimeline);
  const toolShare = trace.durationMs > 0 ? (lanes.toolMs / trace.durationMs) * 100 : 0;
  return (
    <section className="rounded-xl border border-line p-3">
      <header className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span className="font-medium text-ink">{new Date(trace.at).toLocaleString()}</span>
        <span>{trace.model}</span>
        <span>{formatMs(trace.durationMs)}</span>
        <span>{trace.steps} 步</span>
        <span className={cn(trace.outcome === 'completed' ? 'text-emerald-600' : 'text-danger')}>{trace.outcome}</span>
        {trace.firstEvent?.text !== undefined && <span>首字 {formatMs(trace.firstEvent.text)}</span>}
      </header>
      {trace.durationMs > 0 && (
        <div className="mb-2" title="工具时间含等待你审批的时间">
          <div className="flex h-2 overflow-hidden rounded bg-paper-inset">
            <span className="bg-accent/70" style={{ width: `${100 - toolShare}%` }} />
            <span className="bg-ink/50" style={{ width: `${toolShare}%` }} />
          </div>
          <div className="mt-1 flex gap-3 text-[11px] text-ink-muted">
            <span>模型与等待 {formatMs(lanes.modelMs)}</span>
            <span>工具 {formatMs(lanes.toolMs)}</span>
            {trace.setupMs !== undefined && <span>准备 {formatMs(trace.setupMs)}</span>}
          </div>
        </div>
      )}
      {bars.length > 0 ? (
        <ul className="space-y-1">
          {bars.map((bar, i) => (
            <li key={i} className="flex items-center gap-2 text-[11px]">
              <span className="w-32 shrink-0 truncate text-ink" title={bar.name}>{bar.name}</span>
              <span className="relative h-3 flex-1 rounded bg-paper-inset">
                <span className={cn('absolute top-0 h-3 rounded', bar.ok ? 'bg-ink/50' : 'bg-danger/70')} style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }} />
              </span>
              <span className="w-14 shrink-0 text-right text-ink-muted">{formatMs(bar.ms)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-ink-muted">没有工具调用</p>
      )}
      {failed.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-danger">
          {failed.map((t, i) => <li key={i}>{t.name}：{t.error ?? '失败'}</li>)}
        </ul>
      )}
    </section>
  );
}
