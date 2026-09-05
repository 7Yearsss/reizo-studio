import React, { useEffect, useRef, useState } from 'react';
import type { CanvasNode } from '../../../shared/canvas';
import { useAssetUrl } from './useAssetUrl';
import { ImageIcon, Video, Bot, Type, Volume2 } from 'lucide-react';

interface MentionMenuProps {
  candidates: CanvasNode[];
  query: string;
  onSelect: (node: CanvasNode) => void;
  onClose: () => void;
  position?: { top: number; left: number };
  pinnedNodeIds?: string[];
}

function NodeIcon({ type, size = 12 }: { type: string; size?: number }) {
  if (type === 'note') return <Type size={size} className="text-emerald-400 shrink-0" />;
  if (type === 'audio') return <Volume2 size={size} className="text-amber-400 shrink-0" />;
  if (type === 'image') return <ImageIcon size={size} className="text-indigo-400 shrink-0" />;
  if (type === 'video') return <Video size={size} className="text-rose-400 shrink-0" />;
  return <Bot size={size} className="text-sky-400 shrink-0" />;
}

function getNodeCoverAsset(node: CanvasNode): string | undefined {
  const activeIdx = node.output?.activeAssetIndex ?? 0;
  if (node.output?.assets && node.output.assets.length > 0) {
    return node.output.assets[activeIdx] ?? node.output.assets[0];
  }
  if (node.output?.resultSet && node.output.resultSet.length > 0) {
    return node.output.resultSet[activeIdx]?.asset ?? node.output.resultSet[0]?.asset;
  }
  return undefined;
}

function getNodePreviewText(node: CanvasNode): string | undefined {
  if (node.type === 'note') {
    return (node.params as { content?: string })?.content;
  }
  if (node.type === 'image' || node.type === 'video' || node.type === 'audio') {
    return (node.params as { prompt?: string })?.prompt;
  }
  if (node.type === 'agent') {
    return (node.params as { instruction?: string })?.instruction;
  }
  return undefined;
}

function CandidateThumbnail({ node }: { node: CanvasNode }) {
  const asset = getNodeCoverAsset(node);
  const assetUrl = useAssetUrl(asset);

  if (node.type === 'note') {
    return (
      <div className="h-10 w-10 shrink-0 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 flex items-center justify-center font-medium shadow-xs">
        <Type size={16} />
      </div>
    );
  }

  if (node.type === 'audio') {
    return (
      <div className="h-10 w-10 shrink-0 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400 flex items-center justify-center font-medium shadow-xs">
        <Volume2 size={16} />
      </div>
    );
  }

  if (node.type === 'agent') {
    return (
      <div className="h-10 w-10 shrink-0 rounded-lg bg-sky-500/10 border border-sky-500/25 text-sky-400 flex items-center justify-center font-medium shadow-xs">
        <Bot size={16} />
      </div>
    );
  }

  // Video node with generated video asset -> render first frame poster
  if (node.type === 'video' && assetUrl) {
    return (
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-rose-500/30 bg-black/60 shadow-xs">
        <video
          src={`${assetUrl}#t=0.001`}
          preload="metadata"
          muted
          playsInline
          className="pointer-events-none h-full w-full object-cover"
        />
        <div className="absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 py-0.2 text-[8px] text-white/90 leading-none pointer-events-none">
          ▶
        </div>
      </div>
    );
  }

  // Image node with generated/uploaded image asset -> render cover thumbnail
  if (assetUrl) {
    return (
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-indigo-500/30 bg-paper-inset shadow-xs">
        <img
          src={assetUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  // Fallback for nodes without assets yet
  if (node.type === 'video') {
    return (
      <div className="h-10 w-10 shrink-0 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-400 flex items-center justify-center shadow-xs">
        <Video size={16} />
      </div>
    );
  }

  return (
    <div className="h-10 w-10 shrink-0 rounded-lg bg-indigo-500/10 border border-indigo-500/25 text-indigo-400 flex items-center justify-center shadow-xs">
      <ImageIcon size={16} />
    </div>
  );
}

export default function MentionMenu({
  candidates,
  query,
  onSelect,
  onClose,
  position,
  pinnedNodeIds = [],
}: MentionMenuProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const filtered = candidates
    .filter((n) => {
      const title = n.title || '';
      const preview = getNodePreviewText(n) || '';
      const id = n.id || '';
      const q = query.toLowerCase();
      return (
        title.toLowerCase().includes(q) ||
        preview.toLowerCase().includes(q) ||
        id.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const aPinned = pinnedNodeIds.includes(a.id) ? 1 : 0;
      const bPinned = pinnedNodeIds.includes(b.id) ? 1 : 0;
      return bPinned - aPinned;
    });

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  // Keep selected item scrolled into view when navigating via keyboard or mouse
  useEffect(() => {
    const item = itemRefs.current[selectedIdx];
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIdx]);

  // Isolate wheel events natively so scrolling menu list never bubbles to React Flow canvas zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };

    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered[selectedIdx]) {
          e.preventDefault();
          onSelect(filtered[selectedIdx]);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [filtered, selectedIdx, onSelect, onClose]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  if (filtered.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      onWheel={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        // Prevent input blur when clicking menu or dragging scrollbar
        e.preventDefault();
        e.stopPropagation();
      }}
      className="nodrag nopan nowheel overscroll-contain absolute z-50 flex max-h-72 w-80 flex-col overflow-y-auto rounded-xl border border-line/70 bg-[#161618]/95 dark:bg-[#161618]/95 p-1.5 shadow-2xl text-xs backdrop-blur-xl"
      style={
        position
          ? { top: position.top, left: position.left }
          : { bottom: 'calc(100% + 6px)', left: 0 }
      }
    >
      <div className="px-2 py-1 text-[10px] font-semibold text-ink-muted/80 uppercase tracking-wider flex items-center justify-between">
        <span>引用画布节点 (@节点)</span>
        <span className="text-[9px] font-normal text-ink-muted/50">支持搜索提示词 / 标题</span>
      </div>
      <div className="flex flex-col gap-0.5 mt-0.5">
        {filtered.map((node, i) => {
          const title =
            node.title ||
            (node.type === 'image'
              ? '生图'
              : node.type === 'video'
                ? '运镜视频'
                : node.type === 'note'
                  ? '便签提示词'
                  : node.type === 'audio'
                    ? '音频'
                    : `节点 #${node.id.slice(0, 6)}`);
          const isSelected = i === selectedIdx;
          const isPinned = pinnedNodeIds.includes(node.id);
          const previewText = getNodePreviewText(node);
          const hasCover = Boolean(getNodeCoverAsset(node));

          return (
            <button
              key={node.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(node);
              }}
              onMouseEnter={() => setSelectedIdx(i)}
              className={`group flex items-start gap-2.5 rounded-lg p-1.5 text-left transition-all cursor-pointer ${
                isSelected
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'text-ink hover:bg-paper-inset/70'
              }`}
            >
              <div className="pt-0.5 shrink-0">
                <CandidateThumbnail node={node} />
              </div>
              <div className="min-w-0 flex-1 py-0.5">
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <NodeIcon type={node.type} />
                    <span className="truncate font-medium text-xs text-ink">{title}</span>
                    <span className="text-[10px] text-ink-muted/40 font-mono shrink-0">
                      #{node.id.slice(0, 4)}
                    </span>
                  </div>
                  {isPinned ? (
                    <span className="shrink-0 rounded bg-accent/15 border border-accent/25 px-1 py-0.2 text-[9px] text-accent font-normal">
                      已连线
                    </span>
                  ) : hasCover ? (
                    <span className="shrink-0 rounded bg-paper-inset/70 border border-line/40 px-1 py-0.2 text-[9px] text-ink-muted/70 font-normal">
                      封面
                    </span>
                  ) : null}
                </div>
                {previewText ? (
                  <div
                    className="text-[11px] text-ink-muted/70 truncate font-normal mt-1 leading-snug"
                    title={previewText}
                  >
                    {previewText}
                  </div>
                ) : (
                  <div className="text-[10px] text-ink-muted/35 font-normal mt-1 italic">
                    暂无提示词描述
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
