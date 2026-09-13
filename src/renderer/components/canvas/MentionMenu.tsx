import React, { useEffect, useRef, useState } from 'react';
import type { CanvasNode } from '../../../shared/canvas';
import { useAssetUrl } from './useAssetUrl';
import { ImageIcon, Video, Bot, Type, Volume2, Search } from 'lucide-react';

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

  const filtered = candidates.filter((n) => {
    const title = n.title || '';
    const preview = getNodePreviewText(n) || '';
    const id = n.id || '';
    const q = query.toLowerCase();
    return (
      title.toLowerCase().includes(q) ||
      preview.toLowerCase().includes(q) ||
      id.toLowerCase().includes(q)
    );
  });

  const connected = filtered.filter((n) => pinnedNodeIds.includes(n.id));
  const library = filtered.filter((n) => n.type === 'anchor' && !pinnedNodeIds.includes(n.id));
  const others = filtered.filter((n) => n.type !== 'anchor' && !pinnedNodeIds.includes(n.id));
  const sections: Array<{ key: string; label: string; hint?: string; nodes: CanvasNode[] }> = [
    { key: 'connected', label: '已连接节点', hint: '输入序号快选', nodes: connected },
    { key: 'others', label: '画布节点', nodes: others },
    { key: 'library', label: '个人素材库', nodes: library },
  ].filter((s) => s.nodes.length > 0);

  const flat = sections.flatMap((s) => s.nodes);

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
        setSelectedIdx((prev) => (flat.length ? (prev + 1) % flat.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((prev) => (flat.length ? (prev - 1 + flat.length) % flat.length : 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (flat[selectedIdx]) {
          e.preventDefault();
          onSelect(flat[selectedIdx]);
        }
      }
      const digit = e.key >= '1' && e.key <= '9' ? Number(e.key) : 0;
      if (digit && connected[digit - 1]) {
        e.preventDefault();
        onSelect(connected[digit - 1]);
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [flat, connected, selectedIdx, onSelect, onClose]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  if (flat.length === 0) {
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
      className="nodrag nopan nowheel overscroll-contain absolute z-50 flex max-h-80 w-[22rem] flex-col overflow-y-auto rounded-2xl border border-line/70 bg-[#1a1a1c]/96 p-2 shadow-2xl text-xs backdrop-blur-xl"
      style={
        position
          ? { top: position.top, left: position.left }
          : { bottom: 'calc(100% + 6px)', left: 0 }
      }
    >
      <div className="mb-2 flex items-center gap-2 rounded-xl bg-black/35 px-2.5 py-2 text-ink-muted">
        <Search size={14} className="shrink-0 opacity-70" />
        <span className="text-[13px]">{query || '搜索'}</span>
      </div>
      <div className="flex flex-col gap-2">
        {sections.map((section) => (
          <div key={section.key}>
            <div className="px-2 py-1 flex items-center justify-between">
              <span className="text-[11px] font-medium text-ink-muted">{section.label}</span>
              {section.hint ? (
                <span className="text-[10px] text-ink-muted/45">{section.hint}</span>
              ) : null}
            </div>
            <div className="flex flex-col gap-0.5">
              {section.nodes.map((node) => {
                const i = flat.indexOf(node);
                const title =
                  node.title ||
                  (node.type === 'image'
                    ? 'Image'
                    : node.type === 'video'
                      ? 'Video'
                      : node.type === 'note'
                        ? 'Text'
                        : node.type === 'audio'
                          ? 'Audio'
                          : node.type === 'anchor'
                            ? '素材'
                            : `节点`);
                const isSelected = i === selectedIdx;
                const connectedIdx = connected.findIndex((n) => n.id === node.id);

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
                    className={`group flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-all cursor-pointer ${
                      isSelected ? 'bg-white/8' : 'hover:bg-white/5'
                    }`}
                  >
                    <CandidateThumbnail node={node} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-ink">{title}</div>
                    </div>
                    {connectedIdx >= 0 ? (
                      <span className="shrink-0 flex items-center gap-1 text-[11px] text-ink-muted/70">
                        #{connectedIdx + 1}
                        <NodeIcon type={node.type} size={13} />
                      </span>
                    ) : (
                      <NodeIcon type={node.type} size={13} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
