import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type NodeTypes,
} from '@xyflow/react';
import { ImageIcon, Bot, PlayCircle } from 'lucide-react';
import * as canvasStore from '../../state/canvasStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import ImageNode, { type CanvasNodeData } from './ImageNode';
import AgentNode from './AgentNode';

const NODE_TYPES: NodeTypes = { image: ImageNode, agent: AgentNode };

function CanvasInner({ sessionId }: { sessionId: string }) {
  const storeNodes = useCanvasStore((s) => s.nodesBySession[sessionId]) ?? [];
  const storeEdges = useCanvasStore((s) => s.edgesBySession[sessionId]) ?? [];
  const loaded = useCanvasStore((s) => s.loadedBySession[sessionId]) ?? false;

  useEffect(() => {
    void canvasStore.openCanvas(sessionId).catch((): void => undefined);
    return () => canvasStore.closeCanvas(sessionId);
  }, [sessionId]);

  const nodes: Node<CanvasNodeData>[] = useMemo(
    () =>
      storeNodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: { x: node.x, y: node.y },
        data: { sessionId, node },
      })),
    [storeNodes, sessionId],
  );

  const edges: Edge[] = useMemo(
    () => storeEdges.map((edge) => ({ id: edge.id, source: edge.sourceId, target: edge.targetId })),
    [storeEdges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          canvasStore.moveNode(sessionId, change.id, change.position.x, change.position.y);
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

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        void canvasStore.connectNodes(sessionId, connection.source, connection.target);
      }
    },
    [sessionId],
  );

  const addNode = (type: 'image' | 'agent') => {
    const offset = storeNodes.length * 24;
    void canvasStore.addNode(sessionId, type, { x: 60 + offset, y: 60 + offset });
  };

  const hasImage = storeNodes.some((n) => n.type === 'image');
  const runAll = () => {
    if (!hasImage) return;
    if (!window.confirm('运行整图会按依赖顺序生成所有图片节点（付费）。继续？')) return;
    void canvasStore.runGraph(sessionId, true);
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onInit={(instance) => instance.fitView({ padding: 0.2, maxZoom: 1 })}
      fitView
      proOptions={{ hideAttribution: true }}
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
        <button
          type="button"
          onClick={runAll}
          disabled={!hasImage}
          className="inline-flex items-center gap-1 rounded-lg border border-line bg-ink px-2.5 py-1 text-xs text-paper-raised shadow-sm disabled:opacity-40"
        >
          <PlayCircle size={13} />
          运行整图
        </button>
      </Panel>
      {loaded && storeNodes.length === 0 ? (
        <Panel position="top-center" className="pointer-events-none pt-10 text-xs text-ink-muted">
          还没有节点。点「图片」新建，或让 agent 帮你生成。
        </Panel>
      ) : null}
    </ReactFlow>
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
