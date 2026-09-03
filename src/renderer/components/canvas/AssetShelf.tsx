import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '@xyflow/react';
import { ImagePlus, Link2, Pin } from 'lucide-react';
import { ANCHOR_ROLES, type CanvasAnchorParams } from '../../../shared/canvas';
import { EDGE_COLORS } from './edges/edgeStyles';
import { canvasAssetUrl } from '../../api';
import * as canvasStore from '../../state/canvasStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import { cn } from '../../lib/cn';

function Thumb({ rel }: { rel: string | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!rel) {
      setUrl(null);
      return;
    }
    let ok = true;
    void canvasAssetUrl(rel).then((u) => ok && setUrl(u));
    return () => {
      ok = false;
    };
  }, [rel]);
  return url ? (
    <img src={url} alt="" className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full items-center justify-center bg-paper-inset/60">
      <Pin size={12} className="text-ink-muted" />
    </div>
  );
}

/**
 * Persistent "character & style" shelf, top-right. Lists every `anchor` node on
 * the canvas, takes dropped images to create new ones, and batch-attaches an
 * anchor to the current selection.
 */
export default function AssetShelf({
  sessionId,
  selectedTargetIds,
  flash,
}: {
  sessionId: string;
  selectedTargetIds: string[];
  flash: (msg: string) => void;
}) {
  const nodes = useCanvasStore((s) => s.nodesBySession[sessionId]) ?? [];
  const anchors = useMemo(() => nodes.filter((n) => n.type === 'anchor'), [nodes]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (files: File[]) => {
    files
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, 6)
      .forEach((file, i) => {
        void canvasStore
          .addAnchorFromFile(sessionId, file, { x: 40 + i * 24, y: 40 + i * 24 })
          .catch(() => flash('图钉创建失败'));
      });
  };

  if (anchors.length === 0 && !dragOver) {
    return (
      <Panel position="top-right" className="!m-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles([...e.dataTransfer.files]);
          }}
          className="flex items-center gap-1.5 rounded-xl border border-dashed border-line bg-paper-raised/90 px-2.5 py-1.5 text-[11px] text-ink-muted shadow-sm backdrop-blur-sm hover:border-accent hover:text-ink"
          title="拖入或点击添加主角 / 风格参考图钉，多镜头保持一致"
        >
          <ImagePlus size={13} />
          素材栏
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </Panel>
    );
  }

  return (
    <Panel position="top-right" className="!m-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles([...e.dataTransfer.files]);
        }}
        className={cn(
          'w-44 rounded-xl border bg-paper-raised/95 p-2 shadow-xl backdrop-blur-md',
          dragOver ? 'border-accent border-dashed' : 'border-line',
        )}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1 text-[11px] font-semibold text-ink">
            <Pin size={11} style={{ color: EDGE_COLORS.reference }} />
            素材栏
          </span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded p-0.5 text-ink-muted hover:bg-paper-inset hover:text-ink"
            title="添加参考图钉"
          >
            <ImagePlus size={13} />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          {anchors.map((anchor) => {
            const p = anchor.params as CanvasAnchorParams;
            const roleLabel = ANCHOR_ROLES.find((r) => r.id === (p?.role ?? 'character'))?.label ?? '角色';
            return (
              <div key={anchor.id} className="group flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => canvasStore.focusNode(sessionId, anchor.id)}
                  className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-line"
                  title="定位到该图钉"
                >
                  <Thumb rel={anchor.output?.assets?.[0]} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] font-medium text-ink">{anchor.title || '参考图钉'}</div>
                  <div className="text-[9px] text-ink-muted">{roleLabel}</div>
                </div>
                <button
                  type="button"
                  disabled={selectedTargetIds.length === 0}
                  onClick={() => {
                    void canvasStore
                      .attachAnchor(sessionId, anchor.id, selectedTargetIds)
                      .then((n) => flash(n > 0 ? `已挂到 ${n} 个节点` : '所选节点无法挂载'));
                  }}
                  className="rounded p-1 text-ink-muted opacity-0 transition-opacity hover:bg-paper-inset hover:text-ink group-hover:opacity-100 disabled:opacity-0"
                  title="连到当前选中的图片 / 视频节点"
                >
                  <Link2 size={12} />
                </button>
              </div>
            );
          })}
        </div>

        {selectedTargetIds.length === 0 ? (
          <p className="mt-1.5 text-[9px] leading-snug text-ink-muted/70">选中图片 / 视频节点后可批量挂载</p>
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
    </Panel>
  );
}
