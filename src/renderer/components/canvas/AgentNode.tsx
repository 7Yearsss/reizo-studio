import { useEffect, useRef, useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps, type ResizeParams } from '@xyflow/react';
import { Check, Copy, GitBranchPlus, Loader2, Play } from 'lucide-react';
import type { CanvasAgentParams } from '../../../shared/canvas';
import * as canvasStore from '../../state/canvasStore';
import { cn } from '../../lib/cn';
import { NodeTitle, type CanvasNodeData } from './ImageNode';

export default function AgentNode({ id, data, selected }: NodeProps) {
  const { sessionId, node, highlighted } = data as CanvasNodeData;
  const params = node.params as CanvasAgentParams;
  const [instruction, setInstruction] = useState(params.instruction ?? '');
  const [copied, setCopied] = useState(false);
  const resizeStart = useRef<{ w: number; h: number } | null>(null);
  const running = node.runState === 'running';
  const answer = node.output?.text ?? '';

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
      className={cn(
        'relative flex h-full w-full flex-col rounded-xl border bg-paper-raised p-3 text-xs shadow-sm transition-shadow',
        selected ? 'border-accent ring-1 ring-accent/20' : 'border-line',
        running && 'canvas-node-running',
        highlighted && 'canvas-node-highlight',
      )}
    >
      {selected ? (
        <div className="nodrag absolute -top-8 left-0 z-20 flex items-center gap-1 rounded-lg border border-line bg-paper-raised px-1 py-0.5 shadow-md">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void canvasStore.forkNode(sessionId, node.id);
            }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-ink hover:bg-paper-inset"
            title="克隆此任务为独立变体分支 (保持上游连接)"
          >
            <GitBranchPlus size={11} className="text-accent" />
            变体分支
          </button>
          {answer ? (
            <>
              <div className="h-3 w-px bg-line" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  copyAnswer();
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-ink hover:bg-paper-inset"
                title="复制此节点的输出文本"
              >
                {copied ? <Check size={11} className="text-success" /> : <Copy size={11} className="text-accent" />}
                {copied ? '已复制' : '复制结果'}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
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
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-line !bg-paper" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-line !bg-accent" />

      <div className="mb-2 flex items-center justify-between gap-2">
        <NodeTitle sessionId={sessionId} nodeId={node.id} title={node.title} fallback="Agent 任务" />
        <div className="flex shrink-0 items-center gap-1">
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
