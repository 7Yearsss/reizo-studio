import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  type Viewport,
} from '@xyflow/react';
import {
  ImageIcon,
  Bot,
  PlayCircle,
  Square,
  Copy,
  Trash2,
  MessagesSquare,
  Play,
  Undo2,
  Redo2,
  LayoutGrid,
  AtSign,
  Video,
  GitBranchPlus,
  HelpCircle,
  StickyNote,
  Film,
  Boxes,
  AlignHorizontalDistributeCenter,
  FileDown,
  FileUp,
  Plus,
  Maximize,
  MoreHorizontal,
  ChevronDown,
} from 'lucide-react';
import * as canvasStore from '../../state/canvasStore';
import * as chatStore from '../../state/chatStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import { cn } from '../../lib/cn';
import { layoutGraph, wouldCycle } from '../../../shared/canvasGraph';
import type { CanvasGroupParams, CanvasNodeType } from '../../../shared/canvas';
import ImageNode, { type CanvasNodeData } from './ImageNode';
import AgentNode from './AgentNode';
import VideoNode from './VideoNode';
import NoteNode from './NoteNode';
import GroupNode from './GroupNode';
import StoryboardModal from './StoryboardModal';
import CuttableEdge from './edges/CuttableEdge';

const NODE_TYPES: NodeTypes = {
  image: ImageNode,
  agent: AgentNode,
  video: VideoNode,
  note: NoteNode,
  group: GroupNode,
};
const EDGE_TYPES: EdgeTypes = { cuttable: CuttableEdge, default: CuttableEdge };
const VIEWPORT_KEY = (sessionId: string) => `reizo:canvas-viewport:${sessionId}`;

type Menu =
  | { kind: 'node'; x: number; y: number; nodeId: string }
  | { kind: 'pane'; x: number; y: number; flowX: number; flowY: number };

function CanvasInner({ sessionId }: { sessionId: string }) {
  const storeNodes = useCanvasStore((s) => s.nodesBySession[sessionId]) ?? [];
  const storeEdges = useCanvasStore((s) => s.edgesBySession[sessionId]) ?? [];
  const loaded = useCanvasStore((s) => s.loadedBySession[sessionId]) ?? false;
  const graphRun = useCanvasStore((s) => s.graphRunBySession[sessionId]);
  const history = useCanvasStore((s) => s.historyBySession[sessionId]);
  const focus = useCanvasStore((s) => s.focusBySession[sessionId]);
  const rf = useReactFlow();

  const [menu, setMenu] = useState<Menu | null>(null);
  const [openTool, setOpenTool] = useState<'create' | 'more' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showStoryboard, setShowStoryboard] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragStart = useRef<Record<string, { x: number; y: number }>>({});
  const workflowFileRef = useRef<HTMLInputElement>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    void canvasStore.openCanvas(sessionId).catch((): void => undefined);
    return () => canvasStore.closeCanvas(sessionId);
  }, [sessionId]);

  // The agent touched a node -> pan to it and pulse a highlight.
  useEffect(() => {
    if (!focus) return;
    const node = storeNodes.find((n) => n.id === focus.id);
    if (!node) return;
    rf.setCenter(node.x + node.w / 2, node.y + node.h / 2, { zoom: rf.getZoom(), duration: 300 });
    setHighlightId(focus.id);
    const t = setTimeout(() => setHighlightId(null), 1800);
    return () => clearTimeout(t);
  }, [focus?.id, focus?.at, storeNodes, rf]);

  const restoredRef = useRef(false);
  const restoreViewport = () => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(VIEWPORT_KEY(sessionId));
      if (raw) {
        const v = JSON.parse(raw) as Viewport;
        if (typeof v.x === 'number') {
          rf.setViewport(v);
          return;
        }
      }
    } catch {
      /* ignore */
    }
    rf.fitView({ padding: 0.2, maxZoom: 1 });
  };

  /** Nodes sitting inside a *locked* group — pinned in place. */
  const lockedMembers = useMemo(() => {
    const out = new Set<string>();
    for (const n of storeNodes) {
      if (n.type !== 'group') continue;
      const params = n.params as CanvasGroupParams;
      if (!params.locked) continue;
      for (const id of params.memberIds ?? []) out.add(id);
    }
    return out;
  }, [storeNodes]);

  const nodes: Node<CanvasNodeData>[] = useMemo(
    () =>
      storeNodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: { x: node.x, y: node.y },
        width: node.w,
        height: node.h,
        // Containers render beneath their members and never intercept clicks
        // meant for the nodes inside them.
        zIndex: node.type === 'group' ? 0 : 1,
        draggable: lockedMembers.has(node.id) ? false : undefined,
        data: { sessionId, node, highlighted: node.id === highlightId },
      })),
    [storeNodes, sessionId, highlightId, lockedMembers],
  );

  const runningTargets = useMemo(
    () => new Set(storeNodes.filter((n) => n.runState === 'running').map((n) => n.id)),
    [storeNodes],
  );

  const nodeMap = useMemo(
    () => new Map(storeNodes.map((n) => [n.id, n])),
    [storeNodes],
  );

  const handleCutEdge = useCallback(
    (edgeId: string) => {
      void canvasStore.removeEdge(sessionId, edgeId);
    },
    [sessionId],
  );

  const edges: Edge[] = useMemo(
    () =>
      storeEdges.map((edge) => {
        const isRunning = runningTargets.has(edge.targetId);
        const sourceNode = nodeMap.get(edge.sourceId);
        const targetNode = nodeMap.get(edge.targetId);
        return {
          id: edge.id,
          type: 'cuttable',
          source: edge.sourceId,
          sourceHandle: edge.sourceHandle,
          target: edge.targetId,
          targetHandle: edge.targetHandle,
          animated: isRunning,
          data: {
            sourceType: sourceNode?.type,
            targetType: targetNode?.type,
            isRunning,
            onCutEdge: handleCutEdge,
          },
        };
      }),
    [storeEdges, runningTargets, nodeMap, handleCutEdge],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          const before = canvasStore.nodeById(sessionId, change.id);
          canvasStore.moveNodeLive(sessionId, change.id, change.position.x, change.position.y);
          // Dragging a group container moves everything inside it by the same
          // delta, so members keep their relative layout.
          if (before?.type === 'group') {
            const dx = change.position.x - before.x;
            const dy = change.position.y - before.y;
            if (dx !== 0 || dy !== 0) {
              for (const memberId of canvasStore.groupMemberIds(sessionId, change.id)) {
                const member = canvasStore.nodeById(sessionId, memberId);
                if (member) canvasStore.moveNodeLive(sessionId, memberId, member.x + dx, member.y + dy);
              }
            }
          }
        } else if (change.type === 'remove') {
          void canvasStore.removeNode(sessionId, change.id);
        }
      }
    },
    [sessionId],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') void canvasStore.removeEdge(sessionId, change.id);
      }
    },
    [sessionId],
  );

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const connectingNode = useRef<{ nodeId: string; handleId: string | null; handleType: string | null } | null>(null);
  const [dropConnectMenu, setDropConnectMenu] = useState<{
    sourceNodeId: string;
    sourceHandle: string | null;
    flowX: number;
    flowY: number;
    screenX: number;
    screenY: number;
  } | null>(null);

  const selectedNodes = useMemo(
    () => storeNodes.filter((n) => selectedNodeIds.includes(n.id)),
    [storeNodes, selectedNodeIds],
  );

  const onConnectStart = useCallback(
    (_: MouseEvent | TouchEvent, params: { nodeId: string | null; handleId: string | null; handleType: string | null }) => {
      if (params.nodeId) {
        connectingNode.current = {
          nodeId: params.nodeId,
          handleId: params.handleId,
          handleType: params.handleType,
        };
      }
    },
    [],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const source = connectingNode.current;
      connectingNode.current = null;
      if (!source || !source.nodeId) return;

      const targetEl = event.target as HTMLElement;
      if (targetEl && targetEl.closest('.react-flow__handle')) return;

      const clientX = 'clientX' in event ? event.clientX : (event.touches?.[0]?.clientX ?? 0);
      const clientY = 'clientY' in event ? event.clientY : (event.touches?.[0]?.clientY ?? 0);
      const flowPos = rf.screenToFlowPosition({ x: clientX, y: clientY });

      setDropConnectMenu({
        sourceNodeId: source.nodeId,
        sourceHandle: source.handleId,
        flowX: Math.round(flowPos.x),
        flowY: Math.round(flowPos.y),
        screenX: clientX,
        screenY: clientY,
      });
    },
    [rf],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      connectingNode.current = null;
      if (!connection.source || !connection.target) return;
      void canvasStore
        .connectNodes(sessionId, connection.source, connection.target, connection.sourceHandle, connection.targetHandle)
        .catch((err: unknown) => {
          flash(err instanceof Error ? err.message : '连接失败');
        });
    },
    [sessionId, flash],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      if (storeEdges.some((e) => e.sourceId === c.source && e.targetId === c.target)) return false;
      return !wouldCycle(storeEdges, c.source, c.target);
    },
    [storeEdges],
  );

  const onSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: { id: string }[] }) => {
      const ids = sel.map((n) => n.id);
      setSelectedNodeIds(ids);
      canvasStore.setSelection(sessionId, ids);
    },
    [sessionId],
  );

  const addNode = (type: CanvasNodeType, at?: { x: number; y: number }) => {
    const offset = storeNodes.length * 24;
    void canvasStore.addNode(sessionId, type, at ?? { x: 60 + offset, y: 60 + offset });
  };

  const hasImage = storeNodes.some((n) => n.type === 'image');
  const hasRunnable = storeNodes.some((n) => n.type === 'image' || n.type === 'agent' || n.type === 'video');
  const runAll = () => {
    if (!hasRunnable) return;
    if (!confirmAll) {
      setConfirmAll(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmAll(false), 3000);
      return;
    }
    setConfirmAll(false);
    void canvasStore.runGraph(sessionId);
  };

  const tidy = () => {
    if (storeNodes.length === 0) return;
    canvasStore.applyLayout(sessionId, layoutGraph(storeNodes, storeEdges));
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 250 }), 60);
  };

  const askAgent = (nodeId: string) => {
    const node = storeNodes.find((n) => n.id === nodeId);
    if (!node) return;
    const p = (node.params as { prompt?: string; instruction?: string }) ?? {};
    const desc = p.prompt || p.instruction || node.title || '';
    void chatStore.sendMessage(
      sessionId,
      `请处理画布上的这个${node.type === 'image' ? '图片' : 'Agent'}节点（id: ${nodeId}${desc ? `，内容：「${desc}」` : ''}）。`,
      [],
      {},
    );
  };

  const refToComposer = (nodeId: string) => {
    const node = storeNodes.find((n) => n.id === nodeId);
    if (!node) return;
    const p = (node.params as { prompt?: string; instruction?: string }) ?? {};
    const label = (node.title || p.prompt || p.instruction || node.type).toString().slice(0, 24);
    chatStore.addNodeRef(sessionId, { id: nodeId, label });
    flash('已加入输入框引用');
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) return;
      const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      files.slice(0, 4).forEach((file, i) => {
        void canvasStore
          .importImage(sessionId, file, { x: pos.x + i * 28, y: pos.y + i * 28 })
          .catch(() => flash('导入失败'));
      });
    },
    [sessionId, rf, flash],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable);

      // Meta / Ctrl shortcuts
      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault();
          void canvasStore.undo(sessionId);
        } else if ((k === 'z' && e.shiftKey) || k === 'y') {
          e.preventDefault();
          void canvasStore.redo(sessionId);
        } else if (k === 'a' && !isInput) {
          e.preventDefault();
          const allIds = storeNodes.map((n) => n.id);
          setSelectedNodeIds(allIds);
          canvasStore.setSelection(sessionId, allIds);
        }
        return;
      }

      // Single key shortcuts when not typing
      if (!isInput) {
        const k = e.key.toLowerCase();
        if (k === 'f') {
          e.preventDefault();
          rf.fitView({ padding: 0.2, duration: 250 });
          flash('全景居中 (F)');
        } else if (k === 'r') {
          if (selectedNodeIds.length === 1) {
            e.preventDefault();
            void canvasStore.runNode(sessionId, selectedNodeIds[0]);
            flash('开始运行选中节点 (R)');
          }
        }
      }
    },
    [sessionId, storeNodes, selectedNodeIds, rf, flash],
  );

  return (
    <div
      className="h-full w-full outline-none"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onClick={() => {
        if (menu) setMenu(null);
        if (dropConnectMenu) setDropConnectMenu(null);
        if (openTool) setOpenTool(null);
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onSelectionChange={onSelectionChange}
        onNodeDragStart={(_, __, dragged) => {
          for (const n of dragged) {
            dragStart.current[n.id] = { x: n.position.x, y: n.position.y };
            // A group drag also moves its members — snapshot them too so the
            // whole gesture can be undone in one step.
            for (const memberId of canvasStore.groupMemberIds(sessionId, n.id)) {
              const member = canvasStore.nodeById(sessionId, memberId);
              if (member) dragStart.current[memberId] = { x: member.x, y: member.y };
            }
          }
        }}
        onNodeDragStop={(_, __, dragged) => {
          const moves: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
          const collect = (id: string) => {
            const from = dragStart.current[id];
            const now = canvasStore.nodeById(sessionId, id);
            if (from && now) moves.push({ id, from, to: { x: now.x, y: now.y } });
            delete dragStart.current[id];
          };
          for (const n of dragged) {
            collect(n.id);
            for (const memberId of canvasStore.groupMemberIds(sessionId, n.id)) collect(memberId);
          }
          canvasStore.commitMoveBatch(sessionId, moves);
        }}
        onInit={restoreViewport}
        onMoveEnd={(_, v) => {
          try {
            localStorage.setItem(VIEWPORT_KEY(sessionId), JSON.stringify(v));
          } catch {
            /* ignore */
          }
        }}
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          setMenu({ kind: 'node', x: e.clientX, y: e.clientY, nodeId: node.id });
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          const pe = e as unknown as MouseEvent;
          const flow = rf.screenToFlowPosition({ x: pe.clientX, y: pe.clientY });
          setMenu({ kind: 'pane', x: pe.clientX, y: pe.clientY, flowX: flow.x, flowY: flow.y });
        }}
        onDoubleClick={(e) => {
          const target = e.target as HTMLElement;
          if (
            target.closest('.react-flow__node') ||
            target.closest('.canvas-tool') ||
            target.closest('.react-flow__controls') ||
            target.closest('.react-flow__panel')
          ) {
            return;
          }
          const flow = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          setMenu({ kind: 'pane', x: e.clientX, y: e.clientY, flowX: flow.x, flowY: flow.y });
        }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Backspace', 'Delete']}
        panActivationKeyCode="Space"
        className="bg-paper"
      >
        <Background gap={16} color="var(--line)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-paper-inset" />

        {storeNodes.length === 0 ? (
          <Panel position="top-center" className="mt-24 pointer-events-none select-none">
            <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-paper-raised/95 p-6 text-center shadow-xl backdrop-blur-md pointer-events-auto max-w-sm">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <LayoutGrid size={22} />
              </div>
              <h3 className="text-sm font-semibold text-ink">多模态创意流水线画布</h3>
              <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                可视化编排图片生成、运镜视频与多模态 Agent 质检。支持首尾帧插值与变体派生。
              </p>
              <div className="mt-4 flex w-full flex-col gap-2">
                <button
                  type="button"
                  onClick={() => addNode('image', { x: 80, y: 80 })}
                  className="flex items-center justify-center gap-2 rounded-lg bg-ink px-3 py-2 text-xs font-medium text-paper-raised hover:opacity-90 transition-opacity"
                >
                  <ImageIcon size={14} />
                  创建图片生成卡片
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => addNode('video', { x: 80, y: 80 })}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs text-ink hover:bg-paper-inset transition-colors"
                  >
                    <Video size={13} className="text-accent" />
                    创建视频卡片
                  </button>
                  <button
                    type="button"
                    onClick={() => addNode('agent', { x: 80, y: 80 })}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs text-ink hover:bg-paper-inset transition-colors"
                  >
                    <Bot size={13} className="text-accent" />
                    创建 Agent 卡片
                  </button>
                  <button
                    type="button"
                    onClick={() => addNode('note', { x: 80, y: 80 })}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs text-ink hover:bg-paper-inset transition-colors"
                  >
                    <StickyNote size={13} className="text-accent" />
                    创建便签
                  </button>
                </div>
              </div>
              <span className="mt-3 text-[10px] text-ink-muted/70">
                双击空白处或右键打开菜单，也可直接拖入电脑里的图片文件
              </span>
            </div>
          </Panel>
        ) : null}

        <Panel position="top-left" className="flex flex-wrap items-center gap-1.5">
          {/* 创建 */}
          <ToolbarDropdown
            open={openTool === 'create'}
            onToggle={() => setOpenTool((v) => (v === 'create' ? null : 'create'))}
            icon={<Plus size={13} />}
            label="节点"
            primary
            items={[
              { icon: <ImageIcon size={13} />, label: '图片生成', onClick: () => addNode('image') },
              { icon: <Video size={13} />, label: '运镜视频', onClick: () => addNode('video') },
              { icon: <Bot size={13} />, label: 'Agent 任务', onClick: () => addNode('agent') },
              { icon: <StickyNote size={13} />, label: '灵感便签', onClick: () => addNode('note') },
            ]}
          />

          <ToolbarDivider />

          {/* 编辑 */}
          <button type="button" onClick={tidy} disabled={storeNodes.length === 0} className="canvas-tool" title="按依赖分层自动整理布局">
            <LayoutGrid size={13} />
            整理
          </button>
          <button
            type="button"
            onClick={() => void canvasStore.undo(sessionId)}
            disabled={!history?.canUndo}
            className="canvas-tool"
            title="撤销 (Ctrl+Z)"
          >
            <Undo2 size={13} />
            撤销
          </button>
          <button
            type="button"
            onClick={() => void canvasStore.redo(sessionId)}
            disabled={!history?.canRedo}
            className="canvas-tool"
            title="重做 (Ctrl+Shift+Z)"
          >
            <Redo2 size={13} />
            重做
          </button>

          <ToolbarDivider />

          {/* 视图 */}
          <button
            type="button"
            onClick={() => rf.fitView({ padding: 0.2, duration: 250 })}
            className="canvas-tool"
            title="全景居中 (F)"
          >
            <Maximize size={13} />
            适应
          </button>

          <ToolbarDivider />

          {/* 运行 */}
          {graphRun?.running ? (
            <button
              type="button"
              onClick={() => void canvasStore.stopGraph(sessionId)}
              className="canvas-tool !border-danger/30 !bg-danger/10 !text-danger"
            >
              <Square size={12} />
              停止 · {graphRun.done}/{graphRun.total}
            </button>
          ) : (
            <button
              type="button"
              onClick={runAll}
              disabled={!hasRunnable}
              className={cn('canvas-tool', confirmAll ? '!border-accent !bg-accent !text-accent-ink' : '!bg-ink !text-paper-raised')}
            >
              <PlayCircle size={13} />
              {confirmAll ? (hasImage ? '确认运行整图（付费）' : '确认运行整图') : '运行整图'}
            </button>
          )}
          <ToolbarDropdown
            open={openTool === 'more'}
            onToggle={() => setOpenTool((v) => (v === 'more' ? null : 'more'))}
            icon={<MoreHorizontal size={13} />}
            compact
            items={[
              ...(storeNodes.some((n) => n.type === 'video')
                ? [{ icon: <Film size={13} />, label: '串联审片', onClick: () => setShowStoryboard(true) }]
                : []),
              {
                icon: <FileDown size={13} />,
                label: '导出工程 .zip',
                disabled: storeNodes.length === 0,
                onClick: () => {
                  void canvasStore
                    .exportWorkflow(sessionId)
                    .then(() => flash('已导出工程 .reizo.zip'))
                    .catch((err: unknown) => flash(err instanceof Error ? err.message : '导出失败'));
                },
              },
              { icon: <FileUp size={13} />, label: '导入工程 .zip', onClick: () => workflowFileRef.current?.click() },
              { icon: <HelpCircle size={13} />, label: '快捷键速查', onClick: () => setShowShortcuts((s) => !s) },
            ]}
          />
          <input
            ref={workflowFileRef}
            type="file"
            accept=".zip,.reizo.zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              flash('正在导入工程…');
              void canvasStore
                .importWorkflow(sessionId, file)
                .then(({ warnings, count }) => {
                  flash(
                    warnings.length > 0
                      ? `已导入 ${count} 个节点，${warnings.length} 个资产缺失`
                      : `已导入 ${count} 个节点`,
                  );
                  setTimeout(() => rf.fitView({ padding: 0.2, duration: 260 }), 120);
                })
                .catch((err: unknown) => flash(err instanceof Error ? err.message : '导入失败'));
            }}
          />
        </Panel>

        {selectedNodes.length > 0 ? (
          <Panel position="bottom-center" className="pointer-events-auto pb-4">
            <div className="flex items-center gap-2 rounded-2xl border border-line bg-paper-raised/95 px-3.5 py-2 text-xs shadow-2xl backdrop-blur-md">
              <span className="font-semibold text-ink">已选 {selectedNodes.length} 个节点</span>
              <div className="h-3.5 w-px bg-line" />
              <button
                type="button"
                onClick={() => {
                  const descriptions = selectedNodes
                    .map((n) => {
                      const p = (n.params as Record<string, string>) || {};
                      const desc = p.prompt || p.instruction || n.title || '';
                      return `${n.type === 'image' ? '图片' : n.type === 'video' ? '视频' : n.type === 'note' ? '便签' : 'Agent'}节点「${n.title || n.id}」${desc ? `（内容：“${desc}”）` : ''}`;
                    })
                    .join('\n- ');
                  void chatStore.sendMessage(
                    sessionId,
                    `我对画布上的这几个节点有疑问或想法，请帮我审查与优化：\n- ${descriptions}`,
                    [],
                    {},
                  );
                  flash(`已投送 ${selectedNodes.length} 个节点至 Agent 对话`);
                }}
                className="flex items-center gap-1.5 rounded-xl bg-accent text-accent-ink px-3.5 py-1.5 text-xs font-semibold shadow-xs hover:opacity-90 active:scale-95 transition-all"
              >
                <MessagesSquare size={13} className="fill-current" />
                投送给 Agent 质检 ({selectedNodes.length})
              </button>
              {selectedNodes.some((n) => n.type === 'video') ? (
                <button
                  type="button"
                  onClick={() => setShowStoryboard(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/15 text-accent px-3 py-1.5 text-xs font-semibold hover:bg-accent/25 active:scale-95 transition-all shadow-xs"
                  title="连续播放所选分镜短片"
                >
                  <Film size={13} />
                  串联审片 ({selectedNodes.filter((n) => n.type === 'video').length})
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  for (const n of selectedNodes) {
                    refToComposer(n.id);
                  }
                  flash(`已将 ${selectedNodes.length} 个节点引用到输入框`);
                }}
                className="flex items-center gap-1.5 rounded-xl border border-line/70 bg-paper-inset/40 text-ink px-2.5 py-1.5 text-xs font-medium hover:bg-paper-inset/80 active:scale-95 transition-all"
              >
                <AtSign size={12} className="text-accent" />
                引用到输入框
              </button>
              <button
                type="button"
                onClick={() => {
                  void canvasStore.forkSelected(sessionId, selectedNodeIds);
                  flash(`已派生 ${selectedNodes.length} 个变体分支`);
                }}
                className="flex items-center gap-1.5 rounded-xl border border-line/70 bg-paper-inset/40 text-ink px-2.5 py-1.5 text-xs font-medium hover:bg-paper-inset/80 active:scale-95 transition-all"
              >
                <GitBranchPlus size={12} className="text-accent" />
                批量派生变体
              </button>
              <div className="h-3.5 w-px bg-line" />
              <button
                type="button"
                onClick={() => {
                  void canvasStore.arrangeSelectedNodes(sessionId, selectedNodeIds);
                  setTimeout(() => rf.fitView({ padding: 0.25, duration: 260, nodes: selectedNodes.map((n) => ({ id: n.id })) }), 80);
                  flash('已网格对齐所选节点');
                }}
                className="flex items-center gap-1.5 rounded-xl border border-line/70 bg-paper-inset/40 text-ink px-2.5 py-1.5 text-xs font-medium hover:bg-paper-inset/80 active:scale-95 transition-all"
                title="按包围盒中心把所选节点排成紧凑网格"
              >
                <AlignHorizontalDistributeCenter size={12} className="text-accent" />
                网格对齐
              </button>
              {selectedNodes.filter((n) => n.type !== 'group').length >= 2 ? (
                <button
                  type="button"
                  onClick={() => {
                    const members = selectedNodes.filter((n) => n.type !== 'group').map((n) => n.id);
                    void canvasStore.groupNodes(sessionId, members).then((gid) => {
                      if (gid) flash(`已成组 ${members.length} 个节点`);
                    });
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-line/70 bg-paper-inset/40 text-ink px-2.5 py-1.5 text-xs font-medium hover:bg-paper-inset/80 active:scale-95 transition-all"
                  title="用一个容器包住所选节点，可整体拖动 / 锁定 / 仅运行本组"
                >
                  <Boxes size={12} className="text-accent" />
                  成组
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void canvasStore.duplicateSelectedNodes(sessionId, selectedNodeIds).then((ids) => {
                    flash(`已克隆 ${ids.length} 个节点（含内部连线）`);
                  });
                }}
                className="flex items-center gap-1.5 rounded-xl border border-line/70 bg-paper-inset/40 text-ink px-2.5 py-1.5 text-xs font-medium hover:bg-paper-inset/80 active:scale-95 transition-all"
                title="克隆所选节点，并保留它们之间的连线"
              >
                <Copy size={12} className="text-accent" />
                批量克隆
              </button>
            </div>
          </Panel>
        ) : null}

        {toast ? (
          <Panel position="bottom-center" className="pointer-events-none pb-4">
            <div className="rounded-lg bg-ink px-3 py-1.5 text-xs text-paper-raised shadow-lg">{toast}</div>
          </Panel>
        ) : null}
      </ReactFlow>

      {menu ? (
        <div
          className="fixed z-[150] min-w-44 overflow-hidden rounded-lg border border-line bg-paper-raised py-1 text-xs shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.kind === 'node' ? (
            <>
              <MenuItem icon={<Play size={13} />} label="运行这个节点" onClick={() => { void canvasStore.runNode(sessionId, menu.nodeId); setMenu(null); }} />
              <MenuItem icon={<PlayCircle size={13} />} label="从这里往下运行" onClick={() => { void canvasStore.runGraph(sessionId, menu.nodeId); setMenu(null); }} />
              <MenuItem icon={<GitBranchPlus size={13} />} label="派生变体分支" onClick={() => { void canvasStore.forkNode(sessionId, menu.nodeId); setMenu(null); }} />
              <MenuItem icon={<MessagesSquare size={13} />} label="让 agent 处理" onClick={() => { askAgent(menu.nodeId); setMenu(null); }} />
              <MenuItem icon={<AtSign size={13} />} label="引用到输入框" onClick={() => { refToComposer(menu.nodeId); setMenu(null); }} />
              <MenuItem icon={<Copy size={13} />} label="克隆节点" onClick={() => { void canvasStore.duplicateNode(sessionId, menu.nodeId); setMenu(null); }} />
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={<Trash2 size={13} />} label="删除节点" danger onClick={() => { void canvasStore.removeNode(sessionId, menu.nodeId); setMenu(null); }} />
            </>
          ) : (
            <>
              <MenuItem icon={<ImageIcon size={13} />} label="加图片节点" onClick={() => { addNode('image', { x: menu.flowX, y: menu.flowY }); setMenu(null); }} />
              <MenuItem icon={<Video size={13} />} label="加视频节点" onClick={() => { addNode('video', { x: menu.flowX, y: menu.flowY }); setMenu(null); }} />
              <MenuItem icon={<Bot size={13} />} label="加 Agent 节点" onClick={() => { addNode('agent', { x: menu.flowX, y: menu.flowY }); setMenu(null); }} />
              <MenuItem icon={<StickyNote size={13} />} label="加灵感便签" onClick={() => { addNode('note', { x: menu.flowX, y: menu.flowY }); setMenu(null); }} />
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={<LayoutGrid size={13} />} label="整理布局" onClick={() => { tidy(); setMenu(null); }} />
              <MenuItem icon={<PlayCircle size={13} />} label="适应视图" onClick={() => { rf.fitView({ padding: 0.2, duration: 200 }); setMenu(null); }} />
            </>
          )}
        </div>
      ) : null}

      {dropConnectMenu ? (
        <div
          className="fixed z-[160] min-w-48 overflow-hidden rounded-xl border border-line bg-paper-raised p-1 text-xs shadow-2xl backdrop-blur-md"
          style={{ left: dropConnectMenu.screenX, top: dropConnectMenu.screenY }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 text-[10px] font-semibold text-ink-muted">从此处快速延伸流水线</div>
          {(() => {
            const src = storeNodes.find((n) => n.id === dropConnectMenu.sourceNodeId);
            if (src?.type === 'image') {
              return (
                <>
                  <MenuItem
                    icon={<Video size={13} className="text-accent" />}
                    label="生成运镜视频"
                    onClick={() => {
                      void canvasStore.addNodeAndConnect(
                        sessionId,
                        {
                          type: 'video',
                          x: dropConnectMenu.flowX,
                          y: dropConnectMenu.flowY,
                          title: '视频生成',
                          params: { prompt: '', duration: '5s', ratio: '16:9' },
                        },
                        dropConnectMenu.sourceNodeId,
                        dropConnectMenu.sourceHandle,
                        'start_frame',
                      );
                      setDropConnectMenu(null);
                    }}
                  />
                  <MenuItem
                    icon={<Bot size={13} className="text-accent" />}
                    label="+ 画面质检 Agent"
                    onClick={() => {
                      void canvasStore.addNodeAndConnect(
                        sessionId,
                        {
                          type: 'agent',
                          x: dropConnectMenu.flowX,
                          y: dropConnectMenu.flowY,
                          title: '画面质检',
                          params: {
                            instruction: '请评估该图片，从画面构图、细节与质感给出点评，并提供优化后的 Prompt 建议。',
                          },
                        },
                        dropConnectMenu.sourceNodeId,
                        dropConnectMenu.sourceHandle,
                      );
                      setDropConnectMenu(null);
                    }}
                  />
                  <MenuItem
                    icon={<GitBranchPlus size={13} className="text-accent" />}
                    label="派生变体分支"
                    onClick={() => {
                      void canvasStore.addNodeAndConnect(
                        sessionId,
                        {
                          type: 'image',
                          x: dropConnectMenu.flowX,
                          y: dropConnectMenu.flowY,
                          title: `${src.title || '图片'} (变体)`,
                          params: { ...(src.params as Record<string, unknown>) },
                        },
                        dropConnectMenu.sourceNodeId,
                        dropConnectMenu.sourceHandle,
                      );
                      setDropConnectMenu(null);
                    }}
                  />
                </>
              );
            }
            return (
              <MenuItem
                icon={<Bot size={13} className="text-accent" />}
                label="+ 质检 Agent"
                onClick={() => {
                  void canvasStore.addNodeAndConnect(
                    sessionId,
                    {
                      type: 'agent',
                      x: dropConnectMenu.flowX,
                      y: dropConnectMenu.flowY,
                      title: '质检 Agent',
                      params: { instruction: '请综合评估此输出，提出优化建议。' },
                    },
                    dropConnectMenu.sourceNodeId,
                    dropConnectMenu.sourceHandle,
                  );
                  setDropConnectMenu(null);
                }}
              />
            );
          })()}
        </div>
      ) : null}

      {showShortcuts ? (
        <div
          className="fixed right-6 top-14 z-[170] w-64 rounded-2xl border border-line bg-paper-raised/95 p-3.5 shadow-2xl backdrop-blur-md text-xs select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-ink">画布效率快捷键</span>
            <button
              type="button"
              onClick={() => setShowShortcuts(false)}
              className="text-ink-muted hover:text-ink text-xs px-1"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-1.5 text-[11px] text-ink">
            <div className="flex justify-between items-center py-0.5 border-b border-line/60">
              <span className="text-ink-muted">全览平滑居中</span>
              <kbd className="rounded bg-paper-inset px-1.5 py-0.5 font-mono text-[10px]">F</kbd>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-line/60">
              <span className="text-ink-muted">运行选中节点</span>
              <kbd className="rounded bg-paper-inset px-1.5 py-0.5 font-mono text-[10px]">R</kbd>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-line/60">
              <span className="text-ink-muted">抓手拖映画布</span>
              <kbd className="rounded bg-paper-inset px-1.5 py-0.5 font-mono text-[10px]">Space + 拖拽</kbd>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-line/60">
              <span className="text-ink-muted">全选所有节点</span>
              <kbd className="rounded bg-paper-inset px-1.5 py-0.5 font-mono text-[10px]">Ctrl / ⌘ + A</kbd>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-line/60">
              <span className="text-ink-muted">撤销 / 重做</span>
              <kbd className="rounded bg-paper-inset px-1.5 py-0.5 font-mono text-[10px]">Ctrl + Z / Y</kbd>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-line/60">
              <span className="text-ink-muted">快速添加节点</span>
              <span className="text-ink text-[10px]">双击空白画布</span>
            </div>
            <div className="flex justify-between items-center py-0.5">
              <span className="text-ink-muted">流水线延伸</span>
              <span className="text-ink text-[10px]">连线松在空白处</span>
            </div>
          </div>
        </div>
      ) : null}

      {showStoryboard ? (
        <StoryboardModal
          nodes={selectedNodes.some((n) => n.type === 'video') ? selectedNodes : storeNodes}
          onClose={() => setShowStoryboard(false)}
        />
      ) : null}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-paper-inset',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Thin vertical rule that separates the toolbar's usage zones. */
function ToolbarDivider() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden />;
}

type ToolbarItem = { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean };

/**
 * A toolbar button that opens a small dropdown of {@link ToolbarItem}s below it.
 * `primary` renders it as the filled accent action (the `＋节点` create button);
 * `compact` drops the text label (the `⋯更多` overflow button). Closing is
 * handled by the pane-level click handler in `CanvasInner` (`openTool` reset).
 */
function ToolbarDropdown({
  open,
  onToggle,
  icon,
  label,
  items,
  primary,
  compact,
}: {
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label?: string;
  items: ToolbarItem[];
  primary?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'canvas-tool',
          compact && '!px-1.5',
          primary && '!bg-ink !text-paper-raised',
          open && !primary && '!bg-paper-inset !text-ink',
        )}
        aria-expanded={open}
      >
        {icon}
        {label && !compact ? label : null}
        {!compact ? <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} /> : null}
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-40 overflow-hidden rounded-lg border border-line bg-paper-raised py-1 text-xs shadow-xl">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                onToggle();
                item.onClick();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-paper-inset disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function CanvasPanel({ sessionId }: { sessionId: string }) {
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <CanvasInner sessionId={sessionId} />
      </ReactFlowProvider>
    </div>
  );
}
