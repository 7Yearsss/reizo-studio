import { Loader2 } from 'lucide-react';
import * as canvasStore from '../../../state/canvasStore';
import { useCanvasStore } from '../../../state/useCanvasStore';
import { useAssetUrl } from '../useAssetUrl';

export default function EditJobStage({
  sessionId,
  jobId,
  beforeUrl,
  onAccept,
  onDiscard,
  allowDelete = true,
}: {
  sessionId: string;
  jobId: string;
  beforeUrl: string;
  onAccept: () => void;
  onDiscard: () => void;
  allowDelete?: boolean;
}) {
  const node = useCanvasStore(
    (s) => (s.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES).find((n) => n.id === jobId),
  );
  const running = node?.runState === 'running';
  const error = node?.output?.error;
  const rel = node?.output?.assets?.[node.output.activeAssetIndex ?? 0] ?? node?.output?.assets?.[0];
  const afterUrl = useAssetUrl(rel);

  return (
    <div className="flex w-[min(720px,92vw)] flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <figure className="overflow-hidden rounded-xl border border-line bg-paper-inset/40">
          <img src={beforeUrl} alt="" className="max-h-[46vh] w-full object-contain" />
          <figcaption className="px-2 py-1 text-center text-[11px] text-ink-muted">之前</figcaption>
        </figure>
        <figure className="relative overflow-hidden rounded-xl border border-line bg-paper-inset/40">
          {afterUrl && !running ? (
            <img src={afterUrl} alt="" className="max-h-[46vh] w-full object-contain" />
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 text-ink-muted">
              <Loader2 size={22} className={running ? 'animate-spin text-accent' : ''} />
              <span className="text-[12px]">{error || (running ? '正在生成…' : '等待结果')}</span>
            </div>
          )}
          <figcaption className="px-2 py-1 text-center text-[11px] text-ink-muted">之后</figcaption>
        </figure>
      </div>
      {error ? <p className="text-center text-[12px] text-danger">{error}</p> : null}
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (allowDelete) void canvasStore.removeNode(sessionId, jobId);
            onDiscard();
          }}
          className="rounded-full border border-line px-3 py-1.5 text-[12px] text-ink hover:bg-paper-inset"
        >
          放弃
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => void canvasStore.runNode(sessionId, jobId)}
          className="rounded-full border border-line px-3 py-1.5 text-[12px] text-ink hover:bg-paper-inset disabled:opacity-40"
        >
          重试
        </button>
        <button
          type="button"
          disabled={running || !afterUrl}
          onClick={onAccept}
          className="rounded-full bg-accent px-3.5 py-1.5 text-[12px] font-medium text-accent-ink disabled:opacity-40"
        >
          接受
        </button>
      </div>
    </div>
  );
}
