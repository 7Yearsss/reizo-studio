import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { NodeResizer, Position, type NodeProps, type ResizeParams } from '@xyflow/react';
import { Check, Copy, GitBranchPlus, Loader2, Play } from 'lucide-react';
import type { CanvasAgentParams } from '../../../shared/canvas';
import * as canvasStore from '../../state/canvasStore';
import { cn } from '../../lib/cn';
import { NodeTitle, type CanvasNodeData } from './ImageNode';
import NodeActionBar, { useHoverIntent, type NodeAction } from './NodeActionBar';
import NodeHandle from './NodeHandle';
import AgentMark from './AgentMark';
import MissingInputWarning from './MissingInputWarning';
import { nodeReadinessIssues } from '../../../shared/canvasReadiness';

function AgentNode({ id, data, selected }: NodeProps) {
  const { sessionId, node, highlighted, agentMark, isProposal } = data as CanvasNodeData;
  const params = node.params as CanvasAgentParams;
  const [instruction, setInstruction] = useState(params.instruction ?? '');
  const [copied, setCopied] = useState(false);
  const resizeStart = useRef<{ w: number; h: number } | null>(null);
  const { hovered, hoverProps } = useHoverIntent();
  const expanded = selected || hovered;
  const running = node.runState === 'running';
  const answer = node.output?.text ?? '';
  const readiness = useMemo(() => nodeReadinessIssues(node, [], new Map()), [node]);

  useEffect(() => {
    setInstruction((params.instruction as string) ?? '');
  }, [params.instruction]);

  const copyAnswer = () => {
    if (!answer) return;
    void navigator.clipboard.writeText(answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
      <NodeActionBar
        visible={selected || hovered}
        actions={[
          {
            id: 'variations',
            icon: <GitBranchPlus size={11} className="text-accent" />,
            label: '变体分支',
            title: '克隆此任务为独立变体分支（保持上游连接）',
            onClick: () => void canvasStore.forkNode(sessionId, node.id),
          },
          ...((answer
            ? [
                {
                  id: 'copy',
                  icon: copied ? (
                    <Check size={11} className="text-success" />
                  ) : (
                    <Copy size={11} className="text-accent" />
                  ),
                  label: copied ? '已复制' : '复制结果',
                  title: '复制此节点的输出文本',
                  onClick: copyAnswer,
                },
              ]
            : []) as NodeAction[]),
        ]}
      />
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

      <div className="mb-2 flex items-center justify-between gap-2">
        <NodeTitle sessionId={sessionId} nodeId={node.id} title={node.title} fallback="Agent 任务" />
        <div className="flex shrink-0 items-center gap-1">
          {!running && readiness.length > 0 ? <MissingInputWarning messages={readiness} /> : null}
          {node.dirty && !running ? (
            <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
              待更新
            </span>
          ) : null}
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
            {node.runState === 'idle' ? '未运行' : running ? '思考中' : node.runState === 'done' ? '完成' : '失败'}
          </span>
        </div>
      </div>

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
        <div className="nodrag mt-2 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-paper px-2 py-1.5 text-[11px] leading-relaxed text-ink">
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
