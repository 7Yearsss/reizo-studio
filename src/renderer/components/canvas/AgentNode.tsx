import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { NodeResizer, Position, type NodeProps, type ResizeParams } from '@xyflow/react';
import { Bot, Loader2, Play } from 'lucide-react';
import type { CanvasAgentParams } from '../../../shared/canvas';
import * as canvasStore from '../../state/canvasStore';
import { cn } from '../../lib/cn';
import FloatingNodeHeader from './FloatingNodeHeader';
import { type CanvasNodeData } from './ImageNode';
import { useHoverIntent } from './NodeActionBar';
import NodeHandle from './NodeHandle';
import AgentMark from './AgentMark';
import MissingInputWarning from './MissingInputWarning';
import { nodeReadinessIssues } from '../../../shared/canvasReadiness';

function AgentNode({ id, data, selected }: NodeProps) {
  const { sessionId, node, highlighted, agentMark, isProposal } = data as CanvasNodeData;
  const params = node.params as CanvasAgentParams;
  const [instruction, setInstruction] = useState(params.instruction ?? '');
  const resizeStart = useRef<{ w: number; h: number } | null>(null);
  const { hovered, hoverProps } = useHoverIntent();
  const expanded = selected || hovered;
  const running = node.runState === 'running';
  const answer = node.output?.text ?? '';
  const readiness = useMemo(() => nodeReadinessIssues(node, [], new Map()), [node]);

  useEffect(() => {
    setInstruction((params.instruction as string) ?? '');
  }, [params.instruction]);

  const run = () => {
    if (running || !instruction.trim()) return;
    if (instruction !== params.instruction) {
      void canvasStore
        .updateNodeParams(sessionId, node.id, { ...params, instruction })
        .then(() => canvasStore.runNode(sessionId, node.id));
    } else {
      void canvasStore.runNode(sessionId, node.id);
    }
  };

  return (
    <div
      {...hoverProps}
      className={cn(
        'relative flex h-full w-full flex-col rounded-xl border bg-paper-raised p-3 text-xs shadow-sm transition-shadow',
        selected ? 'border-accent ring-1 ring-accent/20' : 'border-line',
        running && 'canvas-node-running',
        highlighted && 'canvas-node-highlight',
        isProposal && 'border-dashed !border-2 !border-accent shadow-[0_0_15px_rgba(99,102,241,0.35)] animate-pulse-subtle',
      )}
    >
      <AgentMark show={agentMark} />

      <NodeResizer
        minWidth={240}
        minHeight={160}
        isVisible={selected}
        lineClassName="!border-accent/40"
        handleClassName="!h-2 !w-2 !rounded-sm !border-accent !bg-paper"
        onResizeStart={(_, p: ResizeParams) => {
          resizeStart.current = { w: p.width, h: p.height };
        }}
        onResizeEnd={(_, p: ResizeParams) => {
          const from = resizeStart.current;
          resizeStart.current = null;
          if (from) canvasStore.commitResize(sessionId, id, from, { w: p.width, h: p.height });
        }}
      />
      <NodeHandle type="target" position={Position.Left} kind="image" label="上游输入" expanded={expanded} />
      <NodeHandle type="source" position={Position.Right} kind="prompt" label="文本" expanded={expanded} />

      {/* Floating anti-zoom header outside the card boundary (TapNow design) */}
      <FloatingNodeHeader
        sessionId={sessionId}
        nodeId={node.id}
        title={node.title}
        fallback="Agent 任务"
        icon={<Bot size={13} className="text-sky-400 shrink-0" />}
        selected={selected}
        hovered={hovered}
        running={running}
        status={
          <>
            {!running && readiness.length > 0 ? <MissingInputWarning messages={readiness} /> : null}
            {node.dirty && !running ? (
              <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                待更新
              </span>
            ) : null}
            {node.runState !== 'idle' ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px]',
                  node.runState === 'error'
                    ? 'bg-danger/10 text-danger'
                    : node.runState === 'done'
                      ? 'bg-success/10 text-success'
                      : running
                        ? 'bg-accent/10 text-accent'
                        : 'bg-paper-inset text-ink-muted',
                )}
              >
                {running ? '思考中' : node.runState === 'done' ? '完成' : '失败'}
              </span>
            ) : null}
          </>
        }
      />

      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onBlur={() =>
          instruction !== params.instruction &&
          void canvasStore.updateNodeParams(sessionId, node.id, { ...params, instruction })
        }
        rows={2}
        placeholder="调研 / 批评 / 改写…（可连一个上游节点让它点评其结果）"
        className="nodrag w-full resize-none rounded-lg border border-line bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
      />

      <div className="mt-2 flex items-center">
        <button
          type="button"
          onClick={run}
          disabled={running || !instruction.trim()}
          className="nodrag ml-auto inline-flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1 text-[11px] text-paper-raised disabled:opacity-40"
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          运行
        </button>
      </div>

      {node.output?.error ? (
        <p className="mt-2 rounded-lg bg-danger/10 px-2 py-1 text-[11px] text-danger">{node.output.error}</p>
      ) : null}

      {answer ? (
        <div
          onWheel={(e) => e.stopPropagation()}
          className="nodrag nopan nowheel overscroll-contain mt-2 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-paper px-2 py-1.5 text-[11px] leading-relaxed text-ink"
        >
          {answer}
          {running ? <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-accent align-middle" /> : null}
        </div>
      ) : null}
    </div>
  );
}

export default memo(AgentNode, (prev, next) => {
  const prevData = prev.data as CanvasNodeData;
  const nextData = next.data as CanvasNodeData;
  return (
    prev.selected === next.selected &&
    prevData.sessionId === nextData.sessionId &&
    prevData.highlighted === nextData.highlighted &&
    prevData.agentMark === nextData.agentMark &&
    prevData.isProposal === nextData.isProposal &&
    prevData.node === nextData.node
  );
});
