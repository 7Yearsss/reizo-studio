import { Fragment, useEffect, useRef, useState } from 'react';
import { Ellipsis, Loader2, ScanSearch } from 'lucide-react';
import { useStore } from '@xyflow/react';
import type { CanvasNode } from '../../../../shared/canvas';
import { EDIT_META, IMAGE_EDIT_KINDS, type ImageEditKind } from '../../../../shared/canvasImageEdit';
import { estimateNodeCost } from '../../../../shared/canvasPricing';
import { canvasAssetUrlSync } from '../../../api';
import { cn } from '../../../lib/cn';
import Tooltip from '../../ui/Tooltip';
import * as canvasStore from '../../../state/canvasStore';
import { EditKindIcon } from './editIcons';
import { openImageEdit } from './openImageEdit';
import { openRegionMark } from './openRegionMark';
import { segmentImageBlob } from './localMatting';
import { chromeScale } from '../chromeScale';

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
  const scale = chromeScale(zoom);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mattingBusy, setMattingBusy] = useState(false);
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
      const rel = node.output?.assets?.[node.output.activeAssetIndex ?? 0] ?? node.output?.assets?.[0];
      const url = rel ? canvasAssetUrlSync(rel) : null;
      // Local ONNX matting is free and ~2s; fall back to the AI edit if the
      // model can't load (first-run download failure, wasm unsupported, …).
      if (url && !mattingBusy) {
        setMattingBusy(true);
        void segmentImageBlob(url)
          .then((blob) =>
            canvasStore.deriveImageEdit(sessionId, node.id, { kind: 'matting' }, { localResultBlob: blob }),
          )
          .catch(() => canvasStore.deriveImageEdit(sessionId, node.id, { kind: 'matting' }))
          .finally(() => setMattingBusy(false));
        return;
      }
      void canvasStore.deriveImageEdit(sessionId, node.id, { kind: 'matting' });
      return;
    }
    openImageEdit({ sessionId, nodeId: node.id, kind, commitMode: 'derive' });
  };

  const titleFor = (kind: ImageEditKind) => {
    const meta = EDIT_META[kind];
    // matting tries the free local ONNX path first, so no cost hint either.
    if (meta.local || kind === 'matting') return meta.label;
    const cost = estimateNodeCost({
      type: 'image',
      params: { prompt: '', size: '1024x1024', ...(node.params as object), edit: { kind, sourceNodeId: node.id } },
    });
    return `${meta.label} · 约 ${cost} 点`;
  };

  return (
    <div
      className={cn(
        'node-edit-toolbar nodrag cursor-default absolute bottom-[calc(100%+6px)] left-1/2 z-30 flex items-center gap-0.5 rounded-full border border-line bg-paper-raised/95 px-1.5 py-1 shadow-md backdrop-blur-sm whitespace-nowrap transition-opacity',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={{ transform: `translateX(-50%) scale(${scale}) translateY(-30px)`, transformOrigin: 'bottom center' }}
      onClick={(e) => e.stopPropagation()}
    >
      {PRIMARY.map((kind, i) => (
        <Fragment key={kind}>
          {i > 0 ? <span className="mx-0.5 h-3.5 w-px bg-line" /> : null}
          <ToolbarBtn
            kind={kind}
            title={titleFor(kind)}
            busy={kind === 'matting' && mattingBusy}
            onClick={() => activate(kind)}
          />
        </Fragment>
      ))}
      <span className="mx-0.5 h-3.5 w-px bg-line" />
      <Tooltip content="框选区域 → 引用到对话" side="top" wrapperClassName="inline-flex">
        <button
          type="button"
          onClick={() => openRegionMark({ sessionId, nodeId: node.id })}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink hover:bg-paper-inset"
        >
          <ScanSearch size={14} />
        </button>
      </Tooltip>
      <span className="mx-0.5 h-3.5 w-px bg-line" />
      <div ref={moreRef} className="relative">
        <Tooltip content="更多编辑" side="top" wrapperClassName="inline-flex">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink hover:bg-paper-inset"
          >
            <Ellipsis size={14} />
          </button>
        </Tooltip>
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

function ToolbarBtn({
  kind,
  title,
  busy,
  onClick,
}: {
  kind: ImageEditKind;
  title: string;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={title} side="top" wrapperClassName="inline-flex">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink hover:bg-paper-inset disabled:opacity-60"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <EditKindIcon kind={kind} size={14} />}
      </button>
    </Tooltip>
  );
}
