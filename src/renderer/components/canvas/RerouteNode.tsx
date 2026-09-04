import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '../../lib/cn';

/**
 * A compact reroute knot (拐点) to guide edges around other nodes and prevent
 * spaghetti intersections (borrowed from Unreal Blueprint / Blender GN).
 */
function RerouteNode({ selected }: NodeProps) {
  return (
    <div
      className={cn(
        'group relative flex h-4 w-4 items-center justify-center rounded-full border border-line bg-paper-raised shadow-xs transition-all duration-150',
        selected
          ? 'scale-125 border-accent bg-accent/20 ring-2 ring-accent/40'
          : 'hover:scale-125 hover:border-accent hover:bg-paper-inset',
      )}
      title="拐点 (Reroute) — 拖拽调整走线"
    >
      <div className="h-1.5 w-1.5 rounded-full bg-ink-muted transition-colors group-hover:bg-accent" />
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !-left-1 !top-1/2 !-translate-y-1/2 !border-none !bg-transparent"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !-right-1 !top-1/2 !-translate-y-1/2 !border-none !bg-transparent"
      />
    </div>
  );
}

export default memo(RerouteNode);
