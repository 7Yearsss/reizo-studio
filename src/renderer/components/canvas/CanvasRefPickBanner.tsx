import { Panel } from '@xyflow/react';
import { Crosshair, X } from 'lucide-react';
import { useCanvasStore } from '../../state/useCanvasStore';
import * as canvasStore from '../../state/canvasStore';

export default function CanvasRefPickBanner({ sessionId }: { sessionId: string }) {
  const composerId = useCanvasStore((s) => s.pickingCanvasRefsBySession[sessionId]);
  const nodes = useCanvasStore((s) => s.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES);

  if (!composerId) return null;

  const composer = nodes.find((n) => n.id === composerId);
  const count = canvasStore.composerRefIds(composer).length;

  return (
    <Panel position="top-center" className="mt-3 pointer-events-none z-50">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#0ea5e9] pl-3.5 pr-1.5 py-1.5 text-white shadow-[0_10px_28px_rgba(14,165,233,0.4)]">
        <Crosshair size={15} className="shrink-0 opacity-95" />
        <span className="text-[13px] font-semibold tracking-tight">从画布选择参考</span>
        {count > 0 ? (
          <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-medium">已选 {count}</span>
        ) : null}
        <span className="mx-0.5 h-4 w-px bg-white/30" aria-hidden />
        <button
          type="button"
          onClick={() => canvasStore.stopPickingCanvasRefs(sessionId)}
          className="inline-flex items-center gap-1 rounded-full bg-black/20 px-2.5 py-1 text-[12px] font-medium hover:bg-black/30 cursor-pointer"
        >
          退出
          <X size={12} />
        </button>
      </div>
    </Panel>
  );
}
