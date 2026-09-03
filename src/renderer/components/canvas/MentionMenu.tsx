import React, { useEffect, useRef, useState } from 'react';
import type { CanvasNode } from '../../../shared/canvas';
import { canvasAssetUrl } from '../../api';
import { ImageIcon, Video, Bot } from 'lucide-react';

interface MentionMenuProps {
  candidates: CanvasNode[];
  query: string;
  onSelect: (node: CanvasNode) => void;
  onClose: () => void;
  position?: { top: number; left: number };
}

function NodeIcon({ type }: { type: string }) {
  if (type === 'image') return <ImageIcon size={12} className="text-indigo-400" />;
  if (type === 'video') return <Video size={12} className="text-sky-400" />;
  return <Bot size={12} className="text-accent" />;
}

function CandidateThumbnail({ asset }: { asset?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!asset) return;
    let ok = true;
    void canvasAssetUrl(asset).then((u) => {
      if (ok) setUrl(u);
    });
    return () => {
      ok = false;
    };
  }, [asset]);

  if (!url) {
    return <div className="h-6 w-6 shrink-0 rounded bg-paper-inset" />;
  }

  return (
    <img
      src={url}
      alt=""
      className="h-6 w-6 shrink-0 rounded object-cover border border-line/40"
    />
  );
}

export default function MentionMenu({
  candidates,
  query,
  onSelect,
  onClose,
  position,
}: MentionMenuProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = candidates.filter((n) => {
    const title = n.title || n.id.slice(0, 8);
    return title.toLowerCase().includes(query.toLowerCase());
  });

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

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
      className="nodrag absolute z-50 flex max-h-48 w-56 flex-col overflow-y-auto rounded-lg border border-line bg-paper-raised p-1 shadow-lg text-xs backdrop-blur-md"
      style={
        position
          ? { top: position.top, left: position.left }
          : { bottom: 'calc(100% + 4px)', left: 0 }
      }
    >
      <div className="px-2 py-1 text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
        引用画布画面 (@节点)
      </div>
      {filtered.map((node, i) => {
        const title = node.title || `节点 #${node.id.slice(0, 6)}`;
        const asset = node.output?.assets?.[0];
        const isSelected = i === selectedIdx;

        return (
          <button
            key={node.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(node);
            }}
            onMouseEnter={() => setSelectedIdx(i)}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
              isSelected ? 'bg-accent/15 text-accent font-medium' : 'text-ink hover:bg-paper-inset'
            }`}
          >
            <CandidateThumbnail asset={asset} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <NodeIcon type={node.type} />
                <span className="truncate">{title}</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
