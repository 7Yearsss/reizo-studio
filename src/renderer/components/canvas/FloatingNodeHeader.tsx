import { useEffect, useState, memo, type ReactNode, type CSSProperties } from 'react';
import { useStore } from '@xyflow/react';
import { Loader2 } from 'lucide-react';
import * as canvasStore from '../../state/canvasStore';
import { cn } from '../../lib/cn';

export interface NodeTitleProps {
  sessionId: string;
  nodeId: string;
  title: string;
  fallback: string;
  className?: string;
}

export function NodeTitle({
  sessionId,
  nodeId,
  title,
  fallback,
  className,
}: NodeTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  useEffect(() => {
    setDraft(title);
  }, [title]);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          void canvasStore.renameNode(sessionId, nodeId, draft.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(title);
            setEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'nodrag min-w-0 max-w-[160px] rounded bg-paper-inset px-1 text-xs font-semibold text-ink outline-none ring-1 ring-accent/40',
          className,
        )}
      />
    );
  }

  return (
    <span
      className={cn(
        'truncate text-xs font-semibold text-ink/90 hover:text-ink cursor-text select-none tracking-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]',
        className,
      )}
      title="双击重命名"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(title);
        setEditing(true);
      }}
    >
      {title || fallback}
    </span>
  );
}

export interface FloatingNodeHeaderProps {
  sessionId: string;
  nodeId: string;
  title: string;
  fallback: string;
  icon: ReactNode;
  /** Optional variant badge or count (e.g. 变体 1/4 or 248字) */
  badge?: ReactNode;
  /** Optional status badge (idle, running, ready, error, dirty) */
  status?: ReactNode;
  /** Action buttons (e.g. config toggle, copy, etc.) */
  actions?: ReactNode;
  selected?: boolean;
  hovered?: boolean;
  running?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * FloatingNodeHeader elevates the node title & icon above the card boundary
 * with inverse zoom compensation (`scale(1 / zoom)`).
 *
 * At bird's-eye canvas zoom (< 50%), the title text and icon remain at a fixed,
 * crisp physical screen size (matching TapNow's LOD canvas header design),
 * while hiding secondary badges to keep the workflow graph uncluttered.
 *
 * When zoomed in or hovered/selected, full status badges and actions are rendered.
 */
function FloatingNodeHeader({
  sessionId,
  nodeId,
  title,
  fallback,
  icon,
  badge,
  status,
  actions,
  selected = false,
  hovered = false,
  running = false,
  className,
  style,
}: FloatingNodeHeaderProps) {
  // Read current canvas zoom level from React Flow store
  const zoom = useStore((s) => s.transform[2]) || 1;
  // Inverse scale: 1 / zoom, clamped safely to prevent extreme sizes (down to ~12% zoom)
  const scale = Math.min(8, Math.max(1, 1 / zoom));

  // At low zoom, hide minor details and badges to match TapNow's clean bird's-eye view
  const isLowZoom = zoom < 0.5;
  const showDetails = !isLowZoom || selected || hovered;

  return (
    <div
      className={cn(
        'floating-node-header nodrag pointer-events-auto absolute bottom-[calc(100%+6px)] left-0 z-10 flex items-center gap-1.5 select-none whitespace-nowrap',
        className,
      )}
      style={{
        transform: `scale(${scale})`,
        transformOrigin: 'bottom left',
        ...style,
      }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="flex items-center justify-center shrink-0">
          {icon}
        </span>
        <NodeTitle
          sessionId={sessionId}
          nodeId={nodeId}
          title={title}
          fallback={fallback}
        />
        {running ? (
          <Loader2 size={11} className="animate-spin text-accent shrink-0 ml-0.5" />
        ) : null}
      </div>

      {showDetails && (badge || status || actions) ? (
        <div className="flex items-center gap-1 shrink-0">
          {badge}
          {status}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export default memo(FloatingNodeHeader);
