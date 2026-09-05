import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  Panel,
  useReactFlow,
  useStore,
  applyNodeChanges,
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
  Maximize2,
  MoreHorizontal,
  ChevronDown,
  Pin,
  MousePointer2,
  BoxSelect,
  ZoomIn,
  ZoomOut,
  Focus,
  Search,
  ChevronUp,
  X,
  Palette,
  Sparkles,
  FolderKanban,
  Layers,
  Clock,
  Mouse,
  Laptop,
} from 'lucide-react';
import * as canvasStore from '../../state/canvasStore';
import * as chatStore from '../../state/chatStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import { cn } from '../../lib/cn';
import { layoutGraph, wouldCycle } from '../../../shared/canvasGraph';
import { estimateGraphCost } from '../../../shared/canvasPricing';
import type { CanvasEdge, CanvasGroupParams, CanvasNode, CanvasNodeType } from '../../../shared/canvas';
import { extractSubgraph, formatSubgraphForPrompt } from '../../../shared/canvasSubgraph';
import { nodeReadinessIssues } from '../../../shared/canvasReadiness';
import ImageNode, { type CanvasNodeData } from './ImageNode';
import AgentNode from './AgentNode';
import VideoNode from './VideoNode';
import NoteNode from './NoteNode';
import GroupNode from './GroupNode';
import AnchorNode from './AnchorNode';
import RerouteNode from './RerouteNode';
import FrameExtractorNode from './FrameExtractorNode';
import SectionNode from './SectionNode';
import SubgraphNode from './SubgraphNode';
import ProposalBar from './ProposalBar';
import AssetShelf from './AssetShelf';
import AgentActivityStrip from './AgentActivityStrip';
import StoryboardModal from './StoryboardModal';
import CuttableEdge from './edges/CuttableEdge';
import ErrorBoundary from '../ErrorBoundary';
import Tooltip from '../ui/Tooltip';
import { motion, AnimatePresence } from 'motion/react';

const NODE_TYPES: NodeTypes = {
  image: ImageNode,
  agent: AgentNode,
  video: VideoNode,
  note: NoteNode,
  group: GroupNode,
  anchor: AnchorNode,
  reroute: RerouteNode,
  frameExtractor: FrameExtractorNode,
  section: SectionNode,
  subgraph: SubgraphNode,
};
const EDGE_TYPES: EdgeTypes = { cuttable: CuttableEdge, default: CuttableEdge };
const VIEWPORT_KEY = (sessionId: string) => `reizo:canvas-viewport:${sessionId}`;

const MINIMAP_NODE_COLOR = (n: { type?: string }) => {
  if (n.type === 'image') return 'var(--accent, #c26d3a)';
  if (n.type === 'video') return '#0ea5e9';
  if (n.type === 'agent') return '#8b5cf6';
  if (n.type === 'note') return '#eab308';
  if (n.type === 'section' || n.type === 'group') return 'transparent';
  return 'var(--line, #ccc)';
};

type Menu =
  | { kind: 'node'; x: number; y: number; nodeId: string }
  | { kind: 'pane'; x: number; y: number; flowX: number; flowY: number };

function computeNodeInputMeta(
  node: CanvasNode,
  edgesByTarget: Map<string, CanvasEdge[]>,
  nodesById: Map<string, CanvasNode>,
) {
  const incoming = edgesByTarget.get(node.id) || [];
  const readiness = nodeReadinessIssues(node, incoming, nodesById);
  const hasUpstreamPrompt = incoming.some(
    (e) => e.targetHandle === 'prompt' || !e.targetHandle,
  );
  const hasUpstreamStartFrame = incoming.some(
    (e) => e.targetHandle === 'start_frame' || e.targetHandle === 'startFrame',
  );
  const refCount = incoming.filter((e) => (e.targetHandle ?? '').startsWith('ref_')).length;
  const inEdge = incoming[0];
  const upNode = inEdge ? nodesById.get(inEdge.sourceId) : undefined;
  const hasUpstreamAsset = Boolean(upNode?.output?.assets?.[0]);

  return {
    readiness,
    hasUpstreamPrompt,
    hasUpstreamStartFrame,
    refCount,
    hasUpstreamAsset,
  };
}

function CanvasInner({ sessionId }: { sessionId: string }) {
  const storeNodes = useCanvasStore((s) => s.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES);
  const storeEdges = useCanvasStore((s) => s.edgesBySession[sessionId] ?? canvasStore.EMPTY_EDGES);
  const loaded = useCanvasStore((s) => s.loadedBySession[sessionId] ?? false);
  const graphRun = useCanvasStore((s) => s.graphRunBySession[sessionId]);
  const history = useCanvasStore((s) => s.historyBySession[sessionId]);
  const spot = useCanvasStore((s) => s.spotlightBySession[sessionId]);
  const trail = useCanvasStore((s) => s.trailBySession[sessionId] ?? canvasStore.EMPTY_TRAIL);
  const proposals = useCanvasStore((s) => s.proposalsBySession[sessionId] ?? canvasStore.EMPTY_PROPOSALS);
  const rf = useReactFlow();

  const [menu, setMenu] = useState<Menu | null>(null);
  const [openTool, setOpenTool] = useState<
    'create' | 'more' | 'askAgent' | 'batchRatio' | 'batchDuration' | null
  >(null);
  // Runway-style canvas interaction mode: pan-on-drag vs marquee box-select.
  const [mode, setMode] = useState<'select' | 'marquee'>('select');
  // Navigation mode: mouse (wheel zooms) vs trackpad (two-finger scroll pans).
  const [navMode, setNavMode] = useState<'mouse' | 'trackpad'>(() => {
    try {
      return (localStorage.getItem('reizo:canvas-nav-mode') as 'mouse' | 'trackpad') || 'mouse';
    } catch {
      return 'mouse';
    }
  });
  const [toast, setToast] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
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

  // The agent touched node(s) -> pan (one) or fit (many) and pulse a highlight.
  useEffect(() => {
    if (!spot || spot.ids.length === 0) return;
    const present = spot.ids.filter((id) => storeNodes.some((n) => n.id === id));
    if (present.length === 0) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const one = present.length === 1 ? storeNodes.find((n) => n.id === present[0]) : null;
    if (one) {
      rf.setCenter(one.x + one.w / 2, one.y + one.h / 2, {
        zoom: rf.getZoom(),
        duration: reduced ? 0 : 300,
      });
    } else {
      rf.fitView({
        nodes: present.map((id) => ({ id })),
        padding: 0.25,
        maxZoom: 1,
        duration: reduced ? 0 : 400,
      });
    }
    setHighlightIds(present);
    const t = setTimeout(() => setHighlightIds([]), 1800);
    return () => clearTimeout(t);
  }, [spot?.at, storeNodes, rf]);

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

  // Nodes the agent wrote in the last 8s get a `✦` mark. Re-tick while any is fresh.
  const [markTick, setMarkTick] = useState(0);
  const agentMarkedIds = useMemo(() => {
    // markTick in deps: forces recompute on the 1s tick so stale marks drop off.
    void markTick;
    const cutoff = Date.now() - 8000;
    const out = new Set<string>();
    for (const entry of trail ?? []) {
      if (entry.at >= cutoff && entry.status !== 'error') {
        for (const id of entry.nodeIds) out.add(id);
      }
    }
    return out;
  }, [trail, markTick]);
  useEffect(() => {
    if (agentMarkedIds.size === 0) return;
    const t = setTimeout(() => setMarkTick((n) => n + 1), 1000);
    return () => clearTimeout(t);
  }, [agentMarkedIds, markTick]);

  const isDraggingRef = useRef(false);
  const isPanningRef = useRef(false);
  const [isInteracting, setIsInteracting] = useState(false);
  // Zoomed-out overview (many nodes at once): the same LOD treatment we give
  // an active drag/pan also applies here permanently, since backdrop-blur and
  // shadows on dozens of simultaneously-visible cards cost real frame time
  // regardless of whether the user is currently touching the canvas.
  // Two thresholds (not one) give it hysteresis — zoom hovering right at a
  // single cutoff during trackpad-momentum panning would otherwise flip
  // `data-lowzoom` on/off rapidly, which reads as its own flicker.
  const isLowZoomRef = useRef(false);
  const isLowZoom = useStore((s) => {
    const zoom = s.transform[2];
    isLowZoomRef.current = isLowZoomRef.current ? zoom < 0.5 : zoom < 0.45;
    return isLowZoomRef.current;
  });

  const initialNodes = useMemo(() => {
    const nodesById = new Map(storeNodes.map((n) => [n.id, n]));
    const edgesByTarget = new Map<string, CanvasEdge[]>();
    for (const e of storeEdges) {
      const list = edgesByTarget.get(e.targetId);
      if (list) list.push(e);
      else edgesByTarget.set(e.targetId, [e]);
    }
    return storeNodes.map((node) => {
      const meta = computeNodeInputMeta(node, edgesByTarget, nodesById);
      return {
        id: node.id,
        type: node.type,
        position: { x: node.x, y: node.y },
        width: node.w,
        height: node.h,
        zIndex: node.type === 'section' ? -1 : node.type === 'group' ? 0 : 1,
        draggable: lockedMembers.has(node.id) ? false : undefined,
        data: {
          sessionId,
          node,
          highlighted: highlightIds.includes(node.id),
          agentMark: agentMarkedIds.has(node.id),
          isProposal: proposals.includes(node.id),
          ...meta,
        },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isDraggingRef.current) return;
    rf.setNodes((prevNodes) => {
      const prevMap = new Map<string, Node<CanvasNodeData>>();
      for (const n of prevNodes) prevMap.set(n.id, n as Node<CanvasNodeData>);

      const nodesById = new Map(storeNodes.map((n) => [n.id, n]));
      const edgesByTarget = new Map<string, CanvasEdge[]>();
      for (const e of storeEdges) {
        const list = edgesByTarget.get(e.targetId);
        if (list) list.push(e);
        else edgesByTarget.set(e.targetId, [e]);
      }

      const nextNodes: Node<CanvasNodeData>[] = [];
      for (const node of storeNodes) {
        const prev = prevMap.get(node.id);
        const isHighlighted = highlightIds.includes(node.id);
        const isAgentMark = agentMarkedIds.has(node.id);
        const isProposal = proposals.includes(node.id);
        const isLocked = lockedMembers.has(node.id);
        const zIndex = node.type === 'section' ? -1 : node.type === 'group' ? 0 : 1;
        const draggable = isLocked ? false : undefined;

        const {
          readiness,
          hasUpstreamPrompt,
          hasUpstreamStartFrame,
          refCount,
          hasUpstreamAsset,
        } = computeNodeInputMeta(node, edgesByTarget, nodesById);

        const readinessChanged =
          !prev?.data.readiness ||
          prev.data.readiness.length !== readiness.length ||
          prev.data.readiness.some((msg, idx) => msg !== readiness[idx]);

        if (
          prev &&
          prev.type === node.type &&
          prev.position.x === node.x &&
          prev.position.y === node.y &&
          prev.width === node.w &&
          prev.height === node.h &&
          prev.zIndex === zIndex &&
          prev.draggable === draggable &&
          prev.data.node === node &&
          prev.data.highlighted === isHighlighted &&
          prev.data.agentMark === isAgentMark &&
          prev.data.isProposal === isProposal &&
          prev.data.hasUpstreamPrompt === hasUpstreamPrompt &&
          prev.data.hasUpstreamStartFrame === hasUpstreamStartFrame &&
          prev.data.hasUpstreamAsset === hasUpstreamAsset &&
          prev.data.refCount === refCount &&
          !readinessChanged
        ) {
          nextNodes.push(prev);
        } else {
          nextNodes.push({
            id: node.id,
            type: node.type,
            position: { x: node.x, y: node.y },
            width: node.w,
            height: node.h,
            zIndex,
            draggable,
            data: {
              sessionId,
              node,
              highlighted: isHighlighted,
              agentMark: isAgentMark,
              isProposal,
              readiness,
              hasUpstreamPrompt,
              hasUpstreamStartFrame,
              hasUpstreamAsset,
              refCount,
            },
          });
        }
      }
      return nextNodes;
    });
  }, [storeNodes, storeEdges, sessionId, highlightIds, lockedMembers, agentMarkedIds, proposals, rf]);

  const nodeMetaKey = useMemo(
    () => storeNodes.map((n) => `${n.id}:${n.type}:${n.runState}`).join('|'),
    [storeNodes],
  );
  const nodeMetaMap = useMemo(() => {
    const map = new Map<string, { type: string; isRunning: boolean }>();
    if (!nodeMetaKey) return map;
    for (const part of nodeMetaKey.split('|')) {
      const [id, type, runState] = part.split(':');
      if (id) map.set(id, { type, isRunning: runState === 'running' });
    }
    return map;
  }, [nodeMetaKey]);

  const handleCutEdge = useCallback(
    (edgeId: string) => {
      void canvasStore.removeEdge(sessionId, edgeId);
    },
    [sessionId],
  );

  const handleRerouteEdge = useCallback(
    (edgeId: string, screenPos: { x: number; y: number }) => {
      const flowPos = rf.screenToFlowPosition(screenPos);
      void canvasStore.insertRerouteNode(sessionId, edgeId, flowPos);
    },
    [rf, sessionId],
  );

  const edges: Edge[] = useMemo(
    () =>
      storeEdges.map((edge) => {
        const sourceMeta = nodeMetaMap.get(edge.sourceId);
        const targetMeta = nodeMetaMap.get(edge.targetId);
        const isRunning = Boolean(targetMeta?.isRunning || sourceMeta?.isRunning);
        return {
          id: edge.id,
          type: 'cuttable',
          source: edge.sourceId,
          sourceHandle: edge.sourceHandle,
          target: edge.targetId,
          targetHandle: edge.targetHandle,
          animated: isRunning,
          data: {
            sourceType: sourceMeta?.type,
            targetType: targetMeta?.type,
            isRunning,
            onCutEdge: handleCutEdge,
            onRerouteEdge: handleRerouteEdge,
          },
        };
      }),
    [storeEdges, nodeMetaMap, handleCutEdge, handleRerouteEdge],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          void canvasStore.removeNode(sessionId, change.id);
        } else if (change.type === 'position' && change.position) {
          const before = rf.getNode(change.id);
          if (before?.type === 'group' && before.position) {
            const dx = change.position.x - before.position.x;
            const dy = change.position.y - before.position.y;
            if (dx !== 0 || dy !== 0) {
              const memberIds = new Set(canvasStore.groupMemberIds(sessionId, change.id));
              rf.setNodes((currentNodes) =>
                currentNodes.map((n) =>
                  memberIds.has(n.id)
                    ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
                    : n,
                ),
              );
            }
          }
        }
      }
    },
    [sessionId, rf],
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
  const connectingNode = useRef<{ nodeId: string; handleId: string | null; handleType: 'source' | 'target' } | null>(null);
  const [dropConnectMenu, setDropConnectMenu] = useState<{
    nodeId: string;
    handleId: string | null;
    handleType: 'source' | 'target';
    flowX: number;
    flowY: number;
    screenX: number;
    screenY: number;
  } | null>(null);

  const selectedNodes = useMemo(
    () => storeNodes.filter((n) => selectedNodeIds.includes(n.id)),
    [storeNodes, selectedNodeIds],
  );

  const isMoodboard = useCanvasStore((s) => s.moodboardBySession[sessionId] ?? false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);

  const matchedNodes = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return storeNodes.filter((n) => {
      const title = (n.title || '').toLowerCase();
      const p = n.params as Record<string, unknown> | undefined;
      const prompt = String(p?.prompt || p?.instruction || p?.content || p?.description || '').toLowerCase();
      return title.includes(q) || prompt.includes(q);
    });
  }, [searchQuery, storeNodes]);

  const focusNodeAt = useCallback(
    (node: (typeof storeNodes)[number]) => {
      if (node.type === 'section') {
        rf.fitBounds({ x: node.x, y: node.y, width: node.w, height: node.h }, { duration: 400, padding: 0.15 });
      } else {
        rf.setCenter(node.x + node.w / 2, node.y + node.h / 2, {
          zoom: Math.max(rf.getZoom(), 0.7),
          duration: 300,
        });
      }
      setHighlightIds([node.id]);
      setTimeout(() => setHighlightIds((curr) => curr.filter((id) => id !== node.id)), 2200);
    },
    [rf],
  );

  const goToNextMatch = useCallback(() => {
    if (matchedNodes.length === 0) return;
    const nextIdx = (searchMatchIdx + 1) % matchedNodes.length;
    setSearchMatchIdx(nextIdx);
    focusNodeAt(matchedNodes[nextIdx]);
  }, [matchedNodes, searchMatchIdx, focusNodeAt]);

  const goToPrevMatch = useCallback(() => {
    if (matchedNodes.length === 0) return;
    const prevIdx = (searchMatchIdx - 1 + matchedNodes.length) % matchedNodes.length;
    setSearchMatchIdx(prevIdx);
    focusNodeAt(matchedNodes[prevIdx]);
  }, [matchedNodes, searchMatchIdx, focusNodeAt]);

  // Global Canvas shortcuts: H (Moodboard), I / V / T (Instant downstream creation), Cmd/Ctrl+F (Search)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      const isInput =
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        (document.activeElement as HTMLElement)?.isContentEditable;

      // Cmd/Ctrl+F -> Toggle Search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }

      if (e.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
      }

      if (isInput || e.ctrlKey || e.metaKey || e.altKey) return;

      // H -> Moodboard
      if (e.key.toLowerCase() === 'h') {
        e.preventDefault();
        canvasStore.toggleMoodboard(sessionId);
        flash(canvasStore.isMoodboard(sessionId) ? '已切换至情绪板模式 (按 H 退出)' : '已退出情绪板模式');
        return;
      }

      // I / V / T -> Create downstream connected node when 1 node is selected
      if (['i', 'v', 't'].includes(e.key.toLowerCase()) && selectedNodeIds.length === 1) {
        const srcNode = storeNodes.find((n) => n.id === selectedNodeIds[0]);
        if (!srcNode) return;
        e.preventDefault();
        const key = e.key.toLowerCase();
        if (key === 'i') {
          void canvasStore.addNodeAndConnect(
            sessionId,
            {
              type: 'image',
              x: srcNode.x + srcNode.w + 60,
              y: srcNode.y,
              title: srcNode.title ? `${srcNode.title} · 衍生` : '生图',
            },
            srcNode.id,
            null,
            'ref_1',
          );
        } else if (key === 'v') {
          if (srcNode.type === 'image') {
            void canvasStore.animateFromImage(sessionId, srcNode.id);
          } else {
            void canvasStore.addNodeAndConnect(
              sessionId,
              {
                type: 'video',
                x: srcNode.x + srcNode.w + 60,
                y: srcNode.y,
                title: srcNode.title ? `${srcNode.title} · 运镜` : '视频生成',
                params: { prompt: '', duration: '5s', ratio: '16:9' },
              },
              srcNode.id,
              null,
              'start_frame',
            );
          }
        } else if (key === 't') {
          void canvasStore.addNodeAndConnect(
            sessionId,
            {
              type: 'note',
              x: srcNode.x + srcNode.w + 60,
              y: srcNode.y,
              title: '分镜便签',
            },
            srcNode.id,
            null,
            null,
          );
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sessionId, searchOpen, selectedNodeIds, storeNodes, flash]);

  const onConnectStart = useCallback(
    (_: MouseEvent | TouchEvent, params: { nodeId: string | null; handleId: string | null; handleType: string | null }) => {
      if (params.nodeId) {
        connectingNode.current = {
          nodeId: params.nodeId,
          handleId: params.handleId,
          handleType: params.handleType === 'target' ? 'target' : 'source',
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
        nodeId: source.nodeId,
        handleId: source.handleId,
        handleType: source.handleType,
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

  const toggleNavMode = useCallback(() => {
    setNavMode((prev) => {
      const next = prev === 'mouse' ? 'trackpad' : 'mouse';
      try {
        localStorage.setItem('reizo:canvas-nav-mode', next);
      } catch {
        /* ignore */
      }
      flash(next === 'trackpad' ? '已切换至触控板模式 (双指滚动平移)' : '已切换至鼠标模式 (滚轮缩放画布)');
      return next;
    });
  }, [flash]);

  const costEstimate = useMemo(() => {
    return estimateGraphCost(storeNodes, storeEdges);
  }, [storeNodes, storeEdges]);

  const hasImage = storeNodes.some((n) => n.type === 'image');
  const hasRunnable = storeNodes.some((n) => n.type === 'image' || n.type === 'agent' || n.type === 'video');
  const runAll = () => {
    if (!hasRunnable) return;
    if (!confirmAll) {
      setConfirmAll(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmAll(false), 4500);
      const cachedMsg = costEstimate.cachedCount > 0 ? ` (跳过 ${costEstimate.cachedCount} 个已缓存)` : '';
      flash(`准备运行 ${costEstimate.runnableCount} 个待生成节点${cachedMsg}，预计消耗约 ${costEstimate.totalPoints} 算力点。再次点击以确认运行。`);
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

  const zoomToSelection = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    rf.fitView({ nodes: selectedNodeIds.map((id) => ({ id })), padding: 0.3, duration: 250, maxZoom: 1.4 });
  }, [rf, selectedNodeIds]);

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

  const askAgentPreset = useCallback(
    async (preset: 'qa' | 'color' | 'bridge' | 'custom') => {
      setOpenTool(null);
      await canvasStore.flushSelection(sessionId);
      const sub = extractSubgraph(storeNodes, storeEdges, selectedNodeIds);
      const subXml = formatSubgraphForPrompt(sub);

      let promptIntro = '';
      if (preset === 'qa') {
        promptIntro = '请对画布上选中的这组节点画面进行整体质检评估（检查人物连贯性、光影逻辑、构图以及细节缺陷），并给出逐个节点的修改优化建议：';
      } else if (preset === 'color') {
        promptIntro = '请对画布选区的这组画面进行色调与氛围统一规划，分析它们在色彩风格、色温与打光上的差异，并输出一套协调统一的色彩方案与修改 Prompt：';
      } else if (preset === 'bridge') {
        promptIntro = '请分析选中的这组前后镜头分镜，帮我构思并补写 1~2 个中间过渡/串场镜头（包括景别变化、运镜过渡与完整 Prompt），让故事流更加自然顺畅：';
      } else {
        promptIntro = '请根据我选中的这组画布节点与拓扑结构提供分析与建议：';
      }

      const fullMessage = `${promptIntro}\n\n${subXml}`;
      void chatStore.sendMessage(sessionId, fullMessage, [], {});
      flash(`已连带拓扑子图投送给 Agent (${selectedNodeIds.length} 个节点)`);
    },
    [sessionId, storeNodes, storeEdges, selectedNodeIds, flash],
  );

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
        } else if (k === 'v') {
          e.preventDefault();
          setMode('select');
        } else if (k === 'm') {
          e.preventDefault();
          setMode('marquee');
          flash('框选模式：空白拖拽多选 (M)');
        } else if (k === 'z') {
          e.preventDefault();
          zoomToSelection();
        } else if (k === 'r') {
          if (selectedNodeIds.length === 1) {
            e.preventDefault();
            void canvasStore.runNode(sessionId, selectedNodeIds[0]);
            flash('开始运行选中节点 (R)');
          }
        }
      }
    },
    [sessionId, storeNodes, selectedNodeIds, rf, flash, zoomToSelection],
  );

  return (
    <div
      data-dragging={isInteracting ? 'true' : undefined}
      data-lowzoom={isLowZoom ? 'true' : undefined}
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
        defaultNodes={initialNodes}
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
          isDraggingRef.current = true;
          setIsInteracting(true);
          for (const n of dragged) {
            dragStart.current[n.id] = { x: n.position.x, y: n.position.y };
            // A group drag also moves its members — snapshot them too so the
            // whole gesture can be undone in one step.
            for (const memberId of canvasStore.groupMemberIds(sessionId, n.id)) {
              const member = rf.getNode(memberId);
              if (member) dragStart.current[memberId] = { x: member.position.x, y: member.position.y };
            }
          }
        }}
        onNodeDragStop={(_, __, dragged) => {
          isDraggingRef.current = false;
          if (!isPanningRef.current) setIsInteracting(false);
          const moves: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
          const collect = (id: string) => {
            const from = dragStart.current[id];
            const now = rf.getNode(id);
            if (from && now) moves.push({ id, from, to: { x: now.position.x, y: now.position.y } });
            delete dragStart.current[id];
          };
          for (const n of dragged) {
            collect(n.id);
            for (const memberId of canvasStore.groupMemberIds(sessionId, n.id)) collect(memberId);
          }
          canvasStore.commitMoveBatch(sessionId, moves);
        }}
        onInit={restoreViewport}
        onMoveStart={() => {
          isPanningRef.current = true;
          setIsInteracting(true);
        }}
        onMoveEnd={(_, v) => {
          isPanningRef.current = false;
          if (!isDraggingRef.current) setIsInteracting(false);
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
        panOnDrag={mode === 'marquee' ? [1] : true}
        selectionOnDrag={mode === 'marquee'}
        panOnScroll={navMode === 'trackpad'}
        zoomOnScroll={navMode === 'mouse'}
        zoomOnPinch={true}
        className="bg-paper"
      >
        <Background gap={16} color="var(--line)" />
        <MiniMap
          pannable
          zoomable
          className="!bg-paper-inset"
          nodeColor={MINIMAP_NODE_COLOR}
          nodeStrokeColor="transparent"
          nodeBorderRadius={3}
          maskColor="rgba(0, 0, 0, 0.2)"
        />
        <AssetShelf sessionId={sessionId} selectedTargetIds={selectedNodeIds} flash={flash} />
        <AgentActivityStrip sessionId={sessionId} />

        {/* Agent Proposal Diff Review Bar */}
        <Panel position="top-center" className="mt-3 pointer-events-none z-30">
          <ProposalBar
            sessionId={sessionId}
            onFocusProposals={(ids) => {
              rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.35, duration: 250 });
            }}
          />
        </Panel>

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
                  onClick={() => {
                    void canvasStore.loadStarterFlow(sessionId).then(() => {
                      flash('已载入「雨夜霓虹街头」影视分镜工作流');
                      setTimeout(() => rf.fitView({ padding: 0.2, duration: 400 }), 150);
                    });
                  }}
                  className="flex items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-xs font-semibold text-accent-ink shadow-md hover:opacity-95 active:scale-98 transition-all"
                >
                  <Sparkles size={14} />
                  一键载入起手影视工作流 (Flow Template)
                </button>
                <div className="my-1 flex items-center gap-2">
                  <div className="h-px flex-1 bg-line" />
                  <span className="text-[10px] text-ink-muted">或者从空白开始</span>
                  <div className="h-px flex-1 bg-line" />
                </div>
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

        {/* Left rail — create / organise / run (Runway RW-2). */}
        <Panel position="top-left" className="flex flex-col items-center gap-1">
          <ToolbarDropdown
            open={openTool === 'create'}
            onToggle={() => setOpenTool((v) => (v === 'create' ? null : 'create'))}
            icon={<Plus size={14} />}
            primary
            compact
            items={[
              { icon: <ImageIcon size={13} />, label: '图片生成', onClick: () => addNode('image') },
              { icon: <Video size={13} />, label: '运镜视频', onClick: () => addNode('video') },
              { icon: <Bot size={13} />, label: 'Agent 任务', onClick: () => addNode('agent') },
              { icon: <StickyNote size={13} />, label: '灵感便签', onClick: () => addNode('note') },
              { icon: <Pin size={13} />, label: '参考图钉', onClick: () => addNode('anchor') },
            ]}
          />
          <button
            type="button"
            onClick={tidy}
            disabled={storeNodes.length === 0}
            className="canvas-tool !px-1.5"
            title="按依赖分层自动整理布局"
          >
            <LayoutGrid size={13} />
          </button>

          <span className="my-0.5 h-px w-5 bg-line" aria-hidden />

          {graphRun?.running ? (
            <button
              type="button"
              onClick={() => void canvasStore.stopGraph(sessionId)}
              className="canvas-tool !px-1.5 !border-danger/30 !bg-danger/10 !text-danger"
              title={`停止 · ${graphRun.done}/${graphRun.total}`}
            >
              <Square size={12} />
            </button>
          ) : (
            <button
              type="button"
              onClick={runAll}
              disabled={!hasRunnable}
              className={cn(
                'canvas-tool !px-1.5',
                confirmAll ? '!border-accent !bg-accent !text-accent-ink' : '!bg-ink !text-paper-raised',
              )}
              title={
                confirmAll
                  ? `确认运行：${costEstimate.runnableCount} 个待跑${costEstimate.cachedCount > 0 ? ` (${costEstimate.cachedCount} 已缓存)` : ''}，消耗 ~${costEstimate.totalPoints} 算力点`
                  : `运行整图 (${costEstimate.runnableCount} 待跑 · ~${costEstimate.totalPoints} 点)`
              }
            >
              <PlayCircle size={13} />
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

        {/* Bottom nav bar — pan/marquee + zoom + history (Runway RW-1). */}
        <Panel position="bottom-center" className="pb-3">
          <div className="flex items-center gap-0.5 rounded-xl border border-line bg-paper-raised/95 px-1 py-1 shadow-xl backdrop-blur-md">
            <NavButton active={mode === 'select'} onClick={() => setMode('select')} title="选择 / 平移 (V)">
              <MousePointer2 size={14} />
            </NavButton>
            <NavButton active={mode === 'marquee'} onClick={() => setMode('marquee')} title="框选：空白拖拽多选 (M)">
              <BoxSelect size={14} />
            </NavButton>
            <NavButton
              active={navMode === 'trackpad'}
              onClick={toggleNavMode}
              title={
                navMode === 'trackpad'
                  ? '导航：触控板模式 (双指滚动平移，点击切为鼠标)'
                  : '导航：鼠标模式 (滚轮缩放画布，点击切为触控板)'
              }
            >
              {navMode === 'trackpad' ? <Laptop size={14} /> : <Mouse size={14} />}
            </NavButton>
            <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />
            <NavButton onClick={() => rf.zoomOut({ duration: 150 })} title="缩小">
              <ZoomOut size={14} />
            </NavButton>
            <NavButton onClick={() => rf.zoomIn({ duration: 150 })} title="放大">
              <ZoomIn size={14} />
            </NavButton>
            <NavButton onClick={() => rf.fitView({ padding: 0.2, duration: 250 })} title="适应全景 (F)">
              <Maximize size={14} />
            </NavButton>
            <NavButton
              onClick={zoomToSelection}
              disabled={selectedNodeIds.length === 0}
              title="缩放到选中 (Z)"
            >
              <Focus size={14} />
            </NavButton>
            <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />
            <NavButton onClick={() => void canvasStore.undo(sessionId)} disabled={!history?.canUndo} title="撤销 (Ctrl+Z)">
              <Undo2 size={14} />
            </NavButton>
            <NavButton onClick={() => void canvasStore.redo(sessionId)} disabled={!history?.canRedo} title="重做 (Ctrl+Shift+Z)">
              <Redo2 size={14} />
            </NavButton>
          </div>
        </Panel>

        {selectedNodes.length > 0 ? (
          <Panel position="bottom-center" className="pointer-events-auto pb-16">
            <div className="flex items-center gap-2 rounded-2xl border border-line bg-paper-raised/95 px-3.5 py-2 text-xs shadow-2xl backdrop-blur-md">
              <span className="font-semibold text-ink">已选 {selectedNodes.length} 个节点</span>
              <div className="h-3.5 w-px bg-line" />
              <ToolbarDropdown
                open={openTool === 'askAgent'}
                onToggle={() => setOpenTool((v) => (v === 'askAgent' ? null : 'askAgent'))}
                icon={<Bot size={13} className="text-accent" />}
                label={`问 Agent ▾`}
                items={[
                  {
                    icon: <MessagesSquare size={13} className="text-accent" />,
                    label: '质检评估 (质量与画面连贯性)',
                    onClick: () => void askAgentPreset('qa'),
                  },
                  {
                    icon: <Palette size={13} className="text-accent" />,
                    label: '调色建议 (统一色调与光影细节)',
                    onClick: () => void askAgentPreset('color'),
                  },
                  {
                    icon: <Film size={13} className="text-accent" />,
                    label: '串场衔接 (补写中间过渡镜头)',
                    onClick: () => void askAgentPreset('bridge'),
                  },
                  {
                    icon: <Sparkles size={13} className="text-accent" />,
                    label: '自由提问当前选区',
                    onClick: () => void askAgentPreset('custom'),
                  },
                ]}
              />
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
              {selectedNodes.filter((n) => n.type !== 'group' && n.type !== 'section').length >= 2 ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const members = selectedNodes.filter((n) => n.type !== 'group' && n.type !== 'section').map((n) => n.id);
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
                  <button
                    type="button"
                    onClick={() => {
                      const members = selectedNodes.filter((n) => n.type !== 'group' && n.type !== 'section').map((n) => n.id);
                      void canvasStore.createSection(sessionId, members).then((sid) => {
                        if (sid) flash(`已为 ${members.length} 个节点创建场景大区`);
                      });
                    }}
                    className="flex items-center gap-1.5 rounded-xl border border-line/70 bg-paper-inset/40 text-ink px-2.5 py-1.5 text-xs font-medium hover:bg-paper-inset/80 active:scale-95 transition-all"
                    title="创建场景大区框住节点，支持独立标题、剧情描述与整体移动"
                  >
                    <FolderKanban size={12} className="text-accent" />
                    新建分区
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const members = selectedNodes.filter((n) => n.type !== 'group' && n.type !== 'section').map((n) => n.id);
                      void canvasStore.collapseToSubgraph(sessionId, members).then((sgid) => {
                        if (sgid) flash(`已将 ${members.length} 个节点折叠为复合子图`);
                      });
                    }}
                    className="flex items-center gap-1.5 rounded-xl border border-line/70 bg-paper-inset/40 text-ink px-2.5 py-1.5 text-xs font-medium hover:bg-paper-inset/80 active:scale-95 transition-all"
                    title="将所选节点封装为单个外壳节点，暴露虚拟输入输出引脚"
                  >
                    <Layers size={12} className="text-accent" />
                    折叠子图
                  </button>
                </>
              ) : null}
              {selectedNodes.length >= 2 && selectedNodes.every((n) => n.type === 'image') && (
                <ToolbarDropdown
                  open={openTool === 'batchRatio'}
                  onToggle={() => setOpenTool((v) => (v === 'batchRatio' ? null : 'batchRatio'))}
                  icon={<Maximize2 size={12} className="text-accent" />}
                  label="批量画幅 ▾"
                  items={[
                    {
                      icon: <Maximize2 size={12} className="text-accent" />,
                      label: '16:9 横屏 (1536x1024)',
                      onClick: () => {
                        void canvasStore.batchUpdateNodeParams(
                          sessionId,
                          selectedNodes.map((n) => n.id),
                          { size: '1536x1024' },
                        );
                        flash(`已将 ${selectedNodes.length} 个节点批量切换为 16:9`);
                        setOpenTool(null);
                      },
                    },
                    {
                      icon: <Square size={12} className="text-accent" />,
                      label: '1:1 正方 (1024x1024)',
                      onClick: () => {
                        void canvasStore.batchUpdateNodeParams(
                          sessionId,
                          selectedNodes.map((n) => n.id),
                          { size: '1024x1024' },
                        );
                        flash(`已将 ${selectedNodes.length} 个节点批量切换为 1:1`);
                        setOpenTool(null);
                      },
                    },
                    {
                      icon: <Maximize size={12} className="text-accent" />,
                      label: '9:16 竖屏 (1024x1536)',
                      onClick: () => {
                        void canvasStore.batchUpdateNodeParams(
                          sessionId,
                          selectedNodes.map((n) => n.id),
                          { size: '1024x1536' },
                        );
                        flash(`已将 ${selectedNodes.length} 个节点批量切换为 9:16`);
                        setOpenTool(null);
                      },
                    },
                  ]}
                />
              )}
              {selectedNodes.length >= 2 && selectedNodes.every((n) => n.type === 'video') && (
                <ToolbarDropdown
                  open={openTool === 'batchDuration'}
                  onToggle={() => setOpenTool((v) => (v === 'batchDuration' ? null : 'batchDuration'))}
                  icon={<Film size={12} className="text-accent" />}
                  label="批量时长 ▾"
                  items={[
                    {
                      icon: <Clock size={12} className="text-accent" />,
                      label: '5秒 (快速生成)',
                      onClick: () => {
                        void canvasStore.batchUpdateNodeParams(
                          sessionId,
                          selectedNodes.map((n) => n.id),
                          { duration: '5s' },
                        );
                        flash(`已将 ${selectedNodes.length} 个视频节点批量切换为 5s`);
                        setOpenTool(null);
                      },
                    },
                    {
                      icon: <Film size={12} className="text-accent" />,
                      label: '10秒 (长镜头运镜)',
                      onClick: () => {
                        void canvasStore.batchUpdateNodeParams(
                          sessionId,
                          selectedNodes.map((n) => n.id),
                          { duration: '10s' },
                        );
                        flash(`已将 ${selectedNodes.length} 个视频节点批量切换为 10s`);
                        setOpenTool(null);
                      },
                    },
                  ]}
                />
              )}
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

        {isMoodboard && (
          <Panel position="top-center" className="mt-3 z-40">
            <div className="flex items-center gap-2 rounded-full border border-line/80 bg-paper-raised/95 px-3 py-1 text-xs shadow-lg backdrop-blur-md">
              <span className="flex h-2 w-2 rounded-full bg-accent animate-pulse" />
              <span className="font-medium text-ink">情绪板模式 (Moodboard)</span>
              <span className="text-[10px] text-ink-muted">按 H 退出</span>
              <button
                type="button"
                onClick={() => canvasStore.setMoodboard(sessionId, false)}
                className="ml-1 rounded-full p-0.5 hover:bg-paper-inset text-ink-muted hover:text-ink"
              >
                <X size={11} />
              </button>
            </div>
          </Panel>
        )}

        {searchOpen && (
          <Panel position="top-center" className="mt-3 z-50">
            <div className="flex items-center gap-1.5 rounded-xl border border-line bg-paper-raised/95 px-2.5 py-1.5 text-xs shadow-2xl backdrop-blur-md">
              <Search size={13} className="text-ink-muted shrink-0" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchMatchIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) goToPrevMatch();
                    else goToNextMatch();
                  } else if (e.key === 'Escape') {
                    setSearchOpen(false);
                  }
                }}
                placeholder="搜索节点名称、提示词…"
                className="h-6 w-52 bg-transparent text-xs text-ink placeholder:text-ink-muted/60 focus:outline-hidden"
              />
              {matchedNodes.length > 0 ? (
                <span className="text-[10px] text-ink-muted px-1 shrink-0">
                  {searchMatchIdx + 1} / {matchedNodes.length}
                </span>
              ) : searchQuery.trim() ? (
                <span className="text-[10px] text-danger/80 px-1 shrink-0">无匹配</span>
              ) : null}
              <button
                type="button"
                onClick={goToPrevMatch}
                disabled={matchedNodes.length === 0}
                className="rounded p-1 hover:bg-paper-inset text-ink-muted hover:text-ink disabled:opacity-30"
                title="上一个 (Shift+Enter)"
              >
                <ChevronUp size={12} />
              </button>
              <button
                type="button"
                onClick={goToNextMatch}
                disabled={matchedNodes.length === 0}
                className="rounded p-1 hover:bg-paper-inset text-ink-muted hover:text-ink disabled:opacity-30"
                title="下一个 (Enter)"
              >
                <ChevronDown size={12} />
              </button>
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="rounded p-1 hover:bg-paper-inset text-ink-muted hover:text-ink"
                title="关闭 (Esc)"
              >
                <X size={12} />
              </button>
            </div>
          </Panel>
        )}

        {toast ? (
          <Panel position="top-center" className="pointer-events-none mt-3">
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
              <MenuItem icon={<FolderKanban size={13} />} label="加场景大区 (Section)" onClick={() => { addNode('section', { x: menu.flowX, y: menu.flowY }); setMenu(null); }} />
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={<LayoutGrid size={13} />} label="整理布局" onClick={() => { tidy(); setMenu(null); }} />
              <MenuItem icon={<PlayCircle size={13} />} label="适应视图" onClick={() => { rf.fitView({ padding: 0.2, duration: 200 }); setMenu(null); }} />
            </>
          )}
        </div>
      ) : null}

      {dropConnectMenu ? (
        <div
          className="fixed z-[160] min-w-52 overflow-hidden rounded-xl border border-line bg-paper-raised p-1 text-xs shadow-2xl backdrop-blur-md"
          style={{ left: dropConnectMenu.screenX, top: dropConnectMenu.screenY }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const anchorNode = storeNodes.find((n) => n.id === dropConnectMenu.nodeId);
            const isBackward = dropConnectMenu.handleType === 'target';
            const nodeTitle = anchorNode?.title || (anchorNode?.type === 'image' ? '图片' : anchorNode?.type === 'video' ? '视频' : '节点');

            if (isBackward) {
              return (
                <>
                  <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-accent">
                    <span>接入上游输入源</span>
                    <span className="text-[9px] font-normal text-ink-muted truncate max-w-[90px]">➔ {nodeTitle}</span>
                  </div>
                  <MenuItem
                    icon={<StickyNote size={13} className="text-[#4ade80]" />}
                    label="加灵感便签 / 提示词"
                    onClick={() => {
                      void canvasStore.addNodeAndConnectToTarget(
                        sessionId,
                        {
                          type: 'note',
                          x: dropConnectMenu.flowX - 80,
                          y: dropConnectMenu.flowY,
                          title: '提示词',
                        },
                        dropConnectMenu.nodeId,
                        dropConnectMenu.handleId,
                        'prompt_out',
                      );
                      setDropConnectMenu(null);
                    }}
                  />
                  <MenuItem
                    icon={<Bot size={13} className="text-accent" />}
                    label="加 Prompt / 质检 Agent"
                    onClick={() => {
                      void canvasStore.addNodeAndConnectToTarget(
                        sessionId,
                        {
                          type: 'agent',
                          x: dropConnectMenu.flowX - 80,
                          y: dropConnectMenu.flowY,
                          title: '提示词 Agent',
                          params: { instruction: '请为画面生成极富细节与质感的生图 Prompt：' },
                        },
                        dropConnectMenu.nodeId,
                        dropConnectMenu.handleId,
                      );
                      setDropConnectMenu(null);
                    }}
                  />
                  <MenuItem
                    icon={<ImageIcon size={13} className="text-[#818cf8]" />}
                    label="加生图节点 (参考/前序图)"
                    onClick={() => {
                      void canvasStore.addNodeAndConnectToTarget(
                        sessionId,
                        {
                          type: 'image',
                          x: dropConnectMenu.flowX - 80,
                          y: dropConnectMenu.flowY,
                          title: '参考图',
                        },
                        dropConnectMenu.nodeId,
                        dropConnectMenu.handleId,
                      );
                      setDropConnectMenu(null);
                    }}
                  />
                  <MenuItem
                    icon={<Video size={13} className="text-[#f43f5e]" />}
                    label="加视频节点 (前序视频)"
                    onClick={() => {
                      void canvasStore.addNodeAndConnectToTarget(
                        sessionId,
                        {
                          type: 'video',
                          x: dropConnectMenu.flowX - 80,
                          y: dropConnectMenu.flowY,
                          title: '前序视频',
                          params: { prompt: '', duration: '5s', ratio: '16:9' },
                        },
                        dropConnectMenu.nodeId,
                        dropConnectMenu.handleId,
                      );
                      setDropConnectMenu(null);
                    }}
                  />
                  <MenuItem
                    icon={<Film size={13} className="text-accent" />}
                    label="加画面抽帧器"
                    onClick={() => {
                      void canvasStore.addNodeAndConnectToTarget(
                        sessionId,
                        {
                          type: 'frameExtractor',
                          x: dropConnectMenu.flowX - 80,
                          y: dropConnectMenu.flowY,
                          title: '截取帧',
                          params: { mode: 'end' },
                        },
                        dropConnectMenu.nodeId,
                        dropConnectMenu.handleId,
                      );
                      setDropConnectMenu(null);
                    }}
                  />
                </>
              );
            }

            const targetPromptHandle = 'prompt';
            const targetImageHandle = 'ref_1';
            const targetVideoHandle = 'start_frame';

            return (
              <>
                <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-accent">
                  <span>从此处延伸流水线</span>
                  <span className="text-[9px] font-normal text-ink-muted truncate max-w-[90px]">由 {nodeTitle} 派生</span>
                </div>

                {anchorNode?.type === 'image' && (
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
                          title: `${anchorNode.title || '图片'} (变体)`,
                          params: { ...(anchorNode.params as Record<string, unknown>) },
                        },
                        dropConnectMenu.nodeId,
                        dropConnectMenu.handleId,
                        targetImageHandle,
                      );
                      setDropConnectMenu(null);
                    }}
                  />
                )}

                <MenuItem
                  icon={<ImageIcon size={13} className="text-[#818cf8]" />}
                  label="加生图节点"
                  onClick={() => {
                    const tgtHandle =
                      anchorNode?.type === 'note' || anchorNode?.type === 'agent'
                        ? targetPromptHandle
                        : targetImageHandle;
                    void canvasStore.addNodeAndConnect(
                      sessionId,
                      {
                        type: 'image',
                        x: dropConnectMenu.flowX,
                        y: dropConnectMenu.flowY,
                        title: '生图',
                      },
                      dropConnectMenu.nodeId,
                      dropConnectMenu.handleId,
                      tgtHandle,
                    );
                    setDropConnectMenu(null);
                  }}
                />
                <MenuItem
                  icon={<Video size={13} className="text-[#f43f5e]" />}
                  label="加运镜视频"
                  onClick={() => {
                    const tgtHandle =
                      anchorNode?.type === 'note' || anchorNode?.type === 'agent'
                        ? targetPromptHandle
                        : targetVideoHandle;
                    void canvasStore.addNodeAndConnect(
                      sessionId,
                      {
                        type: 'video',
                        x: dropConnectMenu.flowX,
                        y: dropConnectMenu.flowY,
                        title: '视频生成',
                        params: { prompt: '', duration: '5s', ratio: '16:9' },
                      },
                      dropConnectMenu.nodeId,
                      dropConnectMenu.handleId,
                      tgtHandle,
                    );
                    setDropConnectMenu(null);
                  }}
                />
                <MenuItem
                  icon={<Bot size={13} className="text-accent" />}
                  label="加 Agent 质检/分析"
                  onClick={() => {
                    void canvasStore.addNodeAndConnect(
                      sessionId,
                      {
                        type: 'agent',
                        x: dropConnectMenu.flowX,
                        y: dropConnectMenu.flowY,
                        title: '画面质检',
                        params: { instruction: '请评估画面的细节、光影与质感，并给出优化后的 Prompt 建议：' },
                      },
                      dropConnectMenu.nodeId,
                      dropConnectMenu.handleId,
                    );
                    setDropConnectMenu(null);
                  }}
                />
                <MenuItem
                  icon={<StickyNote size={13} className="text-[#4ade80]" />}
                  label="加灵感便签"
                  onClick={() => {
                    void canvasStore.addNodeAndConnect(
                      sessionId,
                      {
                        type: 'note',
                        x: dropConnectMenu.flowX,
                        y: dropConnectMenu.flowY,
                        title: '分镜便签',
                      },
                      dropConnectMenu.nodeId,
                      dropConnectMenu.handleId,
                    );
                    setDropConnectMenu(null);
                  }}
                />
                <MenuItem
                  icon={<Film size={13} className="text-accent" />}
                  label="加画面抽帧转换器"
                  onClick={() => {
                    void canvasStore.addNodeAndConnect(
                      sessionId,
                      {
                        type: 'frameExtractor',
                        x: dropConnectMenu.flowX,
                        y: dropConnectMenu.flowY,
                        title: '画面抽帧',
                        params: { mode: 'end' },
                      },
                      dropConnectMenu.nodeId,
                      dropConnectMenu.handleId,
                      'video_in',
                    );
                    setDropConnectMenu(null);
                  }}
                />
              </>
            );
          })()}
        </div>
      ) : null}

      {showShortcuts ? (
        <div
          className="fixed right-6 top-14 z-[170] w-72 rounded-2xl border border-line bg-paper-raised/95 p-3.5 shadow-2xl backdrop-blur-md text-xs select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-ink">画布效率快捷键指南</span>
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
              <span className="text-ink-muted">全览平滑居中 / 缩放到选中</span>
              <kbd className="rounded bg-paper-inset px-1.5 py-0.5 font-mono text-[10px]">F / Z</kbd>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-line/60">
              <span className="text-ink-muted">纯看图情绪板 (Moodboard)</span>
              <kbd className="rounded bg-paper-inset px-1.5 py-0.5 font-mono text-[10px]">H</kbd>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-line/60">
              <span className="text-ink-muted">建下游节点 (图/视频/便签)</span>
              <kbd className="rounded bg-paper-inset px-1.5 py-0.5 font-mono text-[10px]">I / V / T</kbd>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-line/60">
              <span className="text-ink-muted">全局搜索节点与提示词</span>
              <kbd className="rounded bg-paper-inset px-1.5 py-0.5 font-mono text-[10px]">Ctrl / ⌘ + F</kbd>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-line/60">
              <span className="text-ink-muted">连线插入 Reroute 拐点</span>
              <span className="text-ink text-[10px]">双击任意连线</span>
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
              <span className="text-ink-muted">流水线智能延伸</span>
              <span className="text-ink text-[10px]">引脚拖至空白松开</span>
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

/** A single icon button in the bottom nav bar. */
function NavButton({
  children,
  onClick,
  title,
  active,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip content={title} side="top">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        aria-pressed={active}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent',
          active && '!bg-paper-inset !text-ink',
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
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
          'canvas-tool transition-colors',
          compact && '!px-1.5',
          primary && '!bg-ink !text-paper-raised',
          open && !primary && '!bg-paper-inset !text-ink',
        )}
        aria-expanded={open}
      >
        {icon}
        {label && !compact ? label : null}
        {!compact ? <ChevronDown size={11} className={cn('transition-transform duration-150', open && 'rotate-180')} /> : null}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 top-full z-50 mt-1 min-w-40 overflow-hidden rounded-xl border border-line bg-paper-raised p-1 text-xs shadow-xl backdrop-blur-xl"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  onToggle();
                  item.onClick();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink hover:bg-paper-inset disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function CanvasPanel({ sessionId }: { sessionId: string }) {
  return (
    <div className="h-full w-full">
      <ErrorBoundary>
        <ReactFlowProvider>
          <CanvasInner key={sessionId} sessionId={sessionId} />
        </ReactFlowProvider>
      </ErrorBoundary>
    </div>
  );
}
