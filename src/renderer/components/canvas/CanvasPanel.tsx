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
  type Viewport,
} from '@xyflow/react';
import { ImageIcon, Bot, PlayCircle, Square, Copy, Trash2, MessagesSquare, Play } from 'lucide-react';
import * as canvasStore from '../../state/canvasStore';
import * as chatStore from '../../state/chatStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import { cn } from '../../lib/cn';
import ImageNode, { type CanvasNodeData } from './ImageNode';
import AgentNode from './AgentNode';

const NODE_TYPES: NodeTypes = { image: ImageNode, agent: AgentNode };
const VIEWPORT_KEY = (sessionId: string) => `reizo:canvas-viewport:${sessionId}`;

type Menu =
  | { kind: 'node'; x: number; y: number; nodeId: string }
  | { kind: 'pane'; x: number; y: number; flowX: number; flowY: number };

function CanvasInner({ sessionId }: { sessionId: string }) {
  const storeNodes = useCanvasStore((s) => s.nodesBySession[sessionId]) ?? [];
  const storeEdges = useCanvasStore((s) => s.edgesBySession[sessionId]) ?? [];
  const loaded = useCanvasStore((s) => s.loadedBySession[sessionId]) ?? false;
  const graphRun = useCanvasStore((s) => s.graphRunBySession[sessionId]);
  const rf = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);

  const [menu, setMenu] = useState<Menu | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    void canvasStore.openCanvas(sessionId).catch((): void => undefined);
    return () => canvasStore.closeCanvas(sessionId);
  }, [sessionId]);

  // Restore the last viewport for this session (falls back to fitView on init).
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

  const nodes: Node<CanvasNodeData>[] = useMemo(
    () =>
      storeNodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: { x: node.x, y: node.y },
        width: node.w,
        height: node.h,
        data: { sessionId, node },
      })),
    [storeNodes, sessionId],
  );

  const runningTargets = useMemo(
    () => new Set(storeNodes.filter((n) => n.runState === 'running').map((n) => n.id)),
    [storeNodes],
  );

  const edges: Edge[] = useMemo(
    () =>
      storeEdges.map((edge) => ({
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        animated: runningTargets.has(edge.targetId),
      })),
    [storeEdges, runningTargets],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          canvasStore.moveNode(sessionId, change.id, change.position.x, change.position.y);
        } else if (change.type === 'remove') {
          void canvasStore.removeNode(sessionId, change.id);
        } else if (change.type === 'select') {
          // handled in bulk by onSelectionChange
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

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      void canvasStore.connectNodes(sessionId, connection.source, connection.target).catch((err: unknown) => {
        flash(err instanceof Error ? err.message : '连接失败');
      });
    },
    [sessionId, flash],
  );

  const onSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: { id: string }[] }) => {
      canvasStore.setSelection(sessionId, sel.map((n) => n.id));
    },
    [sessionId],
  );

  const addNode = (type: 'image' | 'agent', at?: { x: number; y: number }) => {
    const offset = storeNodes.length * 24;
    void canvasStore.addNode(sessionId, type, at ?? { x: 60 + offset, y: 60 + offset });
  };

  const hasImage = storeNodes.some((n) => n.type === 'image');
  const runAll = () => {
    if (!hasImage) return;
    if (!confirmAll) {
      setConfirmAll(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmAll(false), 3000);
      return;
    }
    setConfirmAll(false);
    void canvasStore.runGraph(sessionId);
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

  return (
    <div
      ref={wrapRef}
      className="h-full w-full"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onClick={() => menu && setMenu(null)}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
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
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Backspace', 'Delete']}
        className="bg-paper"
      >
        <Background gap={16} color="var(--line)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-paper-inset" />

        <Panel position="top-left" className="flex gap-1.5">
          <button
            type="button"
            onClick={() => addNode('image')}
            className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper-raised px-2.5 py-1 text-xs text-ink shadow-sm hover:bg-paper-inset"
          >
            <ImageIcon size={13} />
            图片
          </button>
          <button
            type="button"
            onClick={() => addNode('agent')}
            className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper-raised px-2.5 py-1 text-xs text-ink shadow-sm hover:bg-paper-inset"
          >
            <Bot size={13} />
            Agent
          </button>
          {graphRun?.running ? (
            <button
              type="button"
              onClick={() => void canvasStore.stopGraph(sessionId)}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-danger/10 px-2.5 py-1 text-xs text-danger shadow-sm"
            >
              <Square size={12} />
              停止 · {graphRun.done}/{graphRun.total}
            </button>
          ) : (
            <button
              type="button"
              onClick={runAll}
              disabled={!hasImage}
              className={cn(
                'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs shadow-sm disabled:opacity-40',
                confirmAll ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-ink text-paper-raised',
              )}
            >
              <PlayCircle size={13} />
              {confirmAll ? '确认运行整图（付费）' : '运行整图'}
            </button>
          )}
        </Panel>

        {loaded && storeNodes.length === 0 ? (
          <Panel position="top-center" className="pointer-events-none pt-10 text-xs text-ink-muted">
            还没有节点。点「图片」新建、拖一张图片进来，或让 agent 帮你生成。
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
          className="fixed z-[150] min-w-40 overflow-hidden rounded-lg border border-line bg-paper-raised py-1 text-xs shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.kind === 'node' ? (
            <>
              <MenuItem
                icon={<Play size={13} />}
                label="运行这个节点"
                onClick={() => {
                  void canvasStore.runNode(sessionId, menu.nodeId);
                  setMenu(null);
                }}
              />
              <MenuItem
                icon={<PlayCircle size={13} />}
                label="从这里往下运行"
                onClick={() => {
                  void canvasStore.runGraph(sessionId, menu.nodeId);
                  setMenu(null);
                }}
              />
              <MenuItem
                icon={<MessagesSquare size={13} />}
                label="让 agent 处理"
                onClick={() => {
                  askAgent(menu.nodeId);
                  setMenu(null);
                }}
              />
              <MenuItem
                icon={<Copy size={13} />}
                label="克隆节点"
                onClick={() => {
                  void canvasStore.duplicateNode(sessionId, menu.nodeId);
                  setMenu(null);
                }}
              />
              <div className="my-1 h-px bg-line" />
              <MenuItem
                icon={<Trash2 size={13} />}
                label="删除"
                danger
                onClick={() => {
                  void canvasStore.removeNode(sessionId, menu.nodeId);
                  setMenu(null);
                }}
              />
            </>
          ) : (
            <>
              <MenuItem
                icon={<ImageIcon size={13} />}
                label="加图片节点"
                onClick={() => {
                  addNode('image', { x: menu.flowX, y: menu.flowY });
                  setMenu(null);
                }}
              />
              <MenuItem
                icon={<Bot size={13} />}
                label="加 Agent 节点"
                onClick={() => {
                  addNode('agent', { x: menu.flowX, y: menu.flowY });
                  setMenu(null);
                }}
              />
              <MenuItem
                icon={<PlayCircle size={13} />}
                label="适应视图"
                onClick={() => {
                  rf.fitView({ padding: 0.2, duration: 200 });
                  setMenu(null);
                }}
              />
            </>
          )}
        </div>
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

export default function CanvasPanel({ sessionId }: { sessionId: string }) {
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <CanvasInner sessionId={sessionId} />
      </ReactFlowProvider>
    </div>
  );
}
