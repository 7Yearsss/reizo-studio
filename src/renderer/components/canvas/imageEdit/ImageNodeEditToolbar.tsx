import { Fragment, useEffect, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { useStore } from '@xyflow/react';
import type { CanvasNode } from '../../../../shared/canvas';
import { EDIT_META, IMAGE_EDIT_KINDS, type ImageEditKind } from '../../../../shared/canvasImageEdit';
import { estimateNodeCost } from '../../../../shared/canvasPricing';
import { cn } from '../../../lib/cn';
import * as canvasStore from '../../../state/canvasStore';
import { EditKindIcon } from './editIcons';
import { openImageEdit } from './openImageEdit';

const PRIMARY = IMAGE_EDIT_KINDS.filter((k) => EDIT_META[k].primary);
const MORE = IMAGE_EDIT_KINDS.filter((k) => !EDIT_META[k].primary);

export default function ImageNodeEditToolbar({
  sessionId,
  node,
  visible,
}: {
  sessionId: string;
  node: CanvasNode;
  visible: boolean;
}) {
  const zoom = useStore((s) => s.transform[2]) || 1;
  const scale = Math.min(8, Math.max(1, 1 / zoom));
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onScroll = () => setMoreOpen(false);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('wheel', onScroll, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('wheel', onScroll);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!visible) setMoreOpen(false);
  }, [visible]);

  const activate = (kind: ImageEditKind) => {
    setMoreOpen(false);
    if (kind === 'matting') {
      void canvasStore.deriveImageEdit(sessionId, node.id, { kind: 'matting' });
      return;
    }
    openImageEdit({ sessionId, nodeId: node.id, kind, commitMode: 'derive' });
  };

  const titleFor = (kind: ImageEditKind) => {
    const meta = EDIT_META[kind];
    if (meta.local) return meta.label;
    const cost = estimateNodeCost({
      type: 'image',
      params: { prompt: '', size: '1024x1024', ...(node.params as object), edit: { kind, sourceNodeId: node.id } },
    });
    return `${meta.label} · 约 ${cost} 点`;
  };

  return (
    <div
      className={cn(
        'node-edit-toolbar nodrag cursor-default absolute bottom-[calc(100%+6px)] left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-paper-raised/95 px-1.5 py-1 shadow-md backdrop-blur-sm whitespace-nowrap transition-opacity',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={{ transform: `translateX(-50%) scale(${scale}) translateY(-30px)`, transformOrigin: 'bottom center' }}
      onClick={(e) => e.stopPropagation()}
    >
      {PRIMARY.map((kind, i) => (
        <Fragment key={kind}>
          {i > 0 ? <span className="mx-0.5 h-3.5 w-px bg-line" /> : null}
          <ToolbarBtn kind={kind} title={titleFor(kind)} onClick={() => activate(kind)} />
        </Fragment>
      ))}
      <span className="mx-0.5 h-3.5 w-px bg-line" />
      <div ref={moreRef} className="relative">
        <button
          type="button"
          title="更多"
          onClick={() => setMoreOpen((v) => !v)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink hover:bg-paper-inset"
        >
          <Ellipsis size={14} />
        </button>
        {moreOpen ? (
          <div className="absolute bottom-[calc(100%+10px)] left-1/2 z-50 min-w-[168px] -translate-x-1/2 rounded-xl border border-line bg-paper-raised py-1 shadow-xl">
            {MORE.map((kind) => (
              <button
                key={kind}
                type="button"
                title={titleFor(kind)}
                onClick={() => activate(kind)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink hover:bg-paper-inset"
              >
                <EditKindIcon kind={kind} size={13} />
                {EDIT_META[kind].label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolbarBtn({ kind, title, onClick }: { kind: ImageEditKind; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink hover:bg-paper-inset"
    >
      <EditKindIcon kind={kind} size={14} />
    </button>
  );
}
