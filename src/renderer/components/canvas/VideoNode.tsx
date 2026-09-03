import { useEffect, useMemo, useRef, useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps, type ResizeParams } from '@xyflow/react';
import { Download, FolderPlus, Loader2, Play, GitBranchPlus, Bot, Video, Camera } from 'lucide-react';
import type { CanvasVideoParams } from '../../../shared/canvas';
import { CANVAS_VIDEO_MODELS } from '../../../shared/canvas';
import { cameraFromPreset } from '../../../shared/cameraMotion';
import { canvasAssetUrl } from '../../api';
import * as canvasStore from '../../state/canvasStore';
import * as chatStore from '../../state/chatStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import { cn } from '../../lib/cn';
import { NodeTitle, type CanvasNodeData } from './ImageNode';
import MentionTextArea from './MentionTextArea';
import CameraDial from './CameraDial';
import NodeActionBar, { useHoverIntent, type NodeAction } from './NodeActionBar';
import MissingInputWarning from './MissingInputWarning';
import { nodeReadinessIssues } from '../../../shared/canvasReadiness';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

function useAssetUrl(rel: string | undefined): string | null {
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
  return url;
}

export default function VideoNode({ id, data, selected }: NodeProps) {
  const { sessionId, node, highlighted } = data as CanvasNodeData;
  const params = (node.params as CanvasVideoParams) || { prompt: '' };
  const [prompt, setPrompt] = useState(params.prompt ?? '');
  const [assetIdx, setAssetIdx] = useState(0);
  const resizeStart = useRef<{ w: number; h: number } | null>(null);
  const running = node.runState === 'running';
  const assets = node.output?.assets ?? [];
  const current = assets[Math.min(assetIdx, assets.length - 1)];
  const assetUrl = useAssetUrl(current);
  const progress = node.output?.progress ?? 0;

  const videoElRef = useRef<HTMLVideoElement>(null);
  const [framePick, setFramePick] = useState<'start' | 'end' | 'current' | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const { hovered, hoverProps } = useHoverIntent();

  const allNodes = useCanvasStore((s) => s.nodesBySession[sessionId]) ?? [];
  const allEdges = useCanvasStore((s) => s.edgesBySession[sessionId]) ?? [];
  const candidates = useMemo(
    () => allNodes.filter((n) => n.id !== node.id && (n.output?.assets?.length ?? 0) > 0),
    [allNodes, node.id],
  );
  const readiness = useMemo(
    () => nodeReadinessIssues(node, allEdges, new Map(allNodes.map((n) => [n.id, n]))),
    [node, allEdges, allNodes],
  );

  useEffect(() => {
    setPrompt((params.prompt as string) ?? '');
  }, [params.prompt]);

  useEffect(() => {
    if (assetIdx >= assets.length) setAssetIdx(0);
  }, [assets.length, assetIdx]);

  const commitPrompt = () => {
    if (prompt === params.prompt) return;
    void canvasStore.updateNodeParams(sessionId, node.id, { ...params, prompt });
  };

  const extractFrame = (pick: 'start' | 'end' | 'current') => {
    if (framePick || assets.length === 0) return;
    setFrameError(null);
    setFramePick(pick);
    const at = pick === 'current' ? (videoElRef.current?.currentTime ?? 0) : 0;
    void canvasStore
      .extractVideoFrame(sessionId, node.id, pick, at, assetIdx)
      .catch((err: unknown) => {
        setFrameError(err instanceof Error ? err.message : '抽帧失败');
        setTimeout(() => setFrameError(null), 3200);
      })
      .finally(() => setFramePick(null));
  };

  const run = () => {
    if (running || !prompt.trim()) return;
    if (prompt !== params.prompt) {
      void canvasStore
        .updateNodeParams(sessionId, node.id, { ...params, prompt })
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
      )}
    >
      <NodeActionBar
        visible={selected || hovered}
        actions={[
          {
            id: 'variations',
            icon: <GitBranchPlus size={11} className="text-accent" />,
            label: '变体 ×4',
            title: '在右侧并排派生 4 个继承参数与首尾帧连线的变体',
            onClick: () => void canvasStore.forkVariations(sessionId, node.id),
          },
          ...((assets.length > 0
            ? [
                {
                  id: 'carryFrame',
                  icon: <Camera size={11} className="text-accent" />,
                  label: '抽尾帧续拍',
                  title: '把尾帧抽成图片节点，用作下一镜的起始帧',
                  onClick: () => extractFrame('end'),
                },
              ]
            : []) as NodeAction[]),
          {
            id: 'qa',
            icon: <Bot size={11} className="text-accent" />,
            label: '质检 Agent',
            title: '在右侧添加连接的视频质检 Agent 节点',
            onClick: () =>
              void canvasStore.addDownstreamAgent(
                sessionId,
                node.id,
                '请评估该生成的视频分镜，从动作连贯性、光影、画面质感给出点评，并提供优化后的视频 Prompt。',
              ),
          },
          ...((assets.length > 0
            ? [
                {
                  id: 'save',
                  icon: <FolderPlus size={11} className="text-accent" />,
                  label: '存为产物',
                  title: '将当前视频存入作品库',
                  onClick: () => void canvasStore.saveAsset(sessionId, node.id, assetIdx),
                },
              ]
            : []) as NodeAction[]),
        ]}
      />

      <NodeResizer
        minWidth={280}
        minHeight={220}
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

      <Handle
        type="target"
        id="start_frame"
        position={Position.Left}
        style={{ top: '65%' }}
        className="!h-2.5 !w-2.5 !border-line !bg-accent"
        title="连接图片作为首帧 (Start Frame)"
      />
      <span
        style={{ top: '65%' }}
        className="pointer-events-none absolute -left-8 -translate-y-1/2 text-[9px] font-medium text-ink-muted/80 select-none text-right w-6"
      >
        首帧
      </span>

      <Handle
        type="target"
        id="end_frame"
        position={Position.Left}
        style={{ top: '85%' }}
        className="!h-2.5 !w-2.5 !border-line !bg-accent/80"
        title="连接图片作为尾帧 (End Frame)"
      />
      <span
        style={{ top: '85%' }}
        className="pointer-events-none absolute -left-8 -translate-y-1/2 text-[9px] font-medium text-ink-muted/80 select-none text-right w-6"
      >
        尾帧
      </span>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-line !bg-accent"
        title="输出：视频产物输出"
      />

      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 min-w-0">
          <Video size={13} className="text-accent shrink-0" />
          <NodeTitle sessionId={sessionId} nodeId={node.id} title={node.title} fallback="视频生成" />
        </div>
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
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'bg-paper-inset text-ink-muted',
            )}
          >
            {node.runState === 'idle'
              ? '未运行'
              : running
                ? `生成中 ${progress > 0 ? `${progress}%` : '...'}`
                : node.runState === 'done'
                  ? '完成'
                  : '失败'}
          </span>
        </div>
      </div>

      <div className="mt-1">
        <MentionTextArea
          value={prompt}
          onChange={setPrompt}
          onCommit={commitPrompt}
          candidates={candidates}
          placeholder="描述画面动态与运镜（输入 @ 可引用画布节点）…"
        />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Video Model Selector */}
          <Select
            value={params.model || 'kling-1.5'}
            onValueChange={(val) =>
              void canvasStore.updateNodeParams(sessionId, node.id, {
                ...params,
                model: val,
              })
            }
          >
            <SelectTrigger
              size="sm"
              className="nodrag h-7 max-w-[140px] rounded-lg border-line/70 bg-paper-inset/40 px-2 py-1 text-[11px] font-medium text-ink hover:border-accent hover:bg-paper-inset/70 transition-colors"
            >
              <div className="flex items-center gap-1 truncate">
                <span className="text-accent text-[10px]">🎬</span>
                <SelectValue placeholder="视频模型" />
              </div>
            </SelectTrigger>
            <SelectContent className="min-w-[170px] rounded-xl border border-line bg-paper-raised/95 shadow-xl backdrop-blur-xl p-1 text-xs">
              {CANVAS_VIDEO_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs py-1.5 cursor-pointer rounded-lg hover:bg-paper-inset">
                  <div className="flex items-center justify-between w-full gap-2">
                    <span>{m.name}</span>
                    {'badge' in m ? (
                      <span className="rounded bg-accent/15 px-1 py-0.5 text-[9px] text-accent font-semibold">
                        {m.badge}
                      </span>
                    ) : null}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Visual camera-motion controller (direction + intensity per axis) */}
          <CameraDial
            value={params.camera ?? cameraFromPreset(params.cameraMotion)}
            onChange={(camera) =>
              void canvasStore.updateNodeParams(sessionId, node.id, { ...params, camera })
            }
          />

          {/* Ratio Segmented Pills (16:9, 9:16, 1:1) */}
          <div className="flex items-center rounded-lg border border-line/60 bg-paper-inset/50 p-0.5">
            {['16:9', '9:16', '1:1'].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() =>
                  void canvasStore.updateNodeParams(sessionId, node.id, {
                    ...params,
                    ratio: r as CanvasVideoParams['ratio'],
                  })
                }
                className={cn(
                  'nodrag rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all',
                  (params.ratio || '16:9') === r
                    ? 'bg-paper-raised text-ink border border-line/60 shadow-xs font-semibold dark:bg-white/15 dark:text-white dark:border-white/20'
                    : 'text-ink-muted hover:text-ink',
                )}
                title={`画幅比例: ${r}`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Duration Segmented Pills (5s, 10s) */}
          <div className="flex items-center rounded-lg border border-line/60 bg-paper-inset/50 p-0.5">
            {['5s', '10s'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() =>
                  void canvasStore.updateNodeParams(sessionId, node.id, {
                    ...params,
                    duration: d as CanvasVideoParams['duration'],
                  })
                }
                className={cn(
                  'nodrag rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all',
                  (params.duration || '5s') === d
                    ? 'bg-paper-raised text-ink border border-line/60 shadow-xs font-semibold dark:bg-white/15 dark:text-white dark:border-white/20'
                    : 'text-ink-muted hover:text-ink',
                )}
                title={`视频时长: ${d}`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={run}
          disabled={running || !prompt.trim()}
          className="nodrag ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent text-accent-ink px-3 py-1 text-[11px] font-medium shadow-xs hover:opacity-90 active:scale-95 transition-all disabled:opacity-40"
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={11} className="fill-current" />}
          生成视频
        </button>
      </div>

      {running ? (
        <div className="mt-2 w-full overflow-hidden rounded-full bg-paper-inset">
          <div
            className="h-1.5 rounded-full bg-accent transition-all duration-300"
            style={{ width: `${Math.max(5, progress)}%` }}
          />
        </div>
      ) : null}

      {node.output?.error ? (
        <div className="mt-2 flex flex-col gap-1 rounded-lg bg-danger/10 p-2 text-[11px] text-danger">
          <p className="line-clamp-2">{node.output.error}</p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void chatStore.sendMessage(
                sessionId,
                `画布上的视频节点「${node.title || node.id}」生成报错：\n“${node.output?.error}”\n当前 Prompt 为：“${prompt}”。\n请分析报错原因（如违禁词/运镜参数冲突/模型超时），并帮我生成修改后的视频 Prompt 与参数建议。`,
                [],
                {},
              );
            }}
            className="nodrag inline-flex items-center gap-1 self-start rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-medium text-danger hover:bg-danger/30 transition-colors"
          >
            <Bot size={11} />
            让 Agent 协助修复提示词
          </button>
        </div>
      ) : null}

      {assetUrl ? (
        <div className="group relative mt-2 min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-black/5 flex items-center justify-center">
          <video
            ref={videoElRef}
            src={assetUrl}
            controls
            playsInline
            loop
            preload="metadata"
            className="nodrag h-full w-full object-contain"
          />
          <div className="nodrag absolute left-1.5 top-1.5 flex flex-col items-start gap-1 opacity-0 transition-opacity group-hover:opacity-100 z-10">
            {(['start', 'end', 'current'] as const).map((pick) => (
              <button
                key={pick}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  extractFrame(pick);
                }}
                disabled={framePick !== null}
                className="inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-1 text-[10px] font-medium text-white hover:bg-black/80 disabled:opacity-50"
                title={
                  pick === 'start'
                    ? '抽取首帧为图片节点，用作下一镜的起始帧'
                    : pick === 'end'
                      ? '抽取尾帧为图片节点，用作下一镜的起始帧'
                      : '抽取当前播放帧为图片节点'
                }
              >
                {framePick === pick ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Camera size={11} />
                )}
                {pick === 'start' ? '抽首帧' : pick === 'end' ? '抽尾帧' : '抽当前帧'}
              </button>
            ))}
          </div>
          {frameError ? (
            <div className="absolute inset-x-2 bottom-9 rounded bg-danger/90 px-2 py-1 text-[10px] text-white shadow">
              {frameError}
            </div>
          ) : null}
          {assets.length > 1 ? (
            <div className="absolute inset-x-0 bottom-7 flex items-center justify-center gap-1 bg-black/40 py-0.5 backdrop-blur-[2px]">
              {assets.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAssetIdx(i);
                  }}
                  className={cn(
                    'nodrag rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors',
                    i === assetIdx
                      ? 'bg-accent text-accent-ink font-semibold shadow-sm'
                      : 'bg-black/60 text-white/80 hover:bg-black/80',
                  )}
                  title={`版本 v${assets.length - i} (点击切换当前视频)`}
                >
                  v{assets.length - i}
                </button>
              ))}
            </div>
          ) : null}
          <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 z-10">
            <a
              href={assetUrl}
              download
              onClick={(e) => e.stopPropagation()}
              className="nodrag rounded-md bg-black/60 p-1 text-white hover:bg-black/80"
              title="下载视频"
            >
              <Download size={12} />
            </a>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void canvasStore.saveAsset(sessionId, node.id, assetIdx);
              }}
              className="nodrag rounded-md bg-black/60 p-1 text-white hover:bg-black/80"
              title="存到作品库"
            >
              <FolderPlus size={12} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
