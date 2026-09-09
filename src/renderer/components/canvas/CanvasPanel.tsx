import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  useReactFlow,
  useStore,
  applyNodeChanges,
  ConnectionMode,
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
  Type,
  Volume2,
  Magnet,
  Workflow,
} from 'lucide-react';
import * as canvasStore from '../../state/canvasStore';
import * as chatStore from '../../state/chatStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import { useChatStore } from '../../state/useChatStore';
import { cn } from '../../lib/cn';
import { layoutGraph, wouldCycle, isPortCompatible } from '../../../shared/canvasGraph';
import { estimateGraphCost } from '../../../shared/canvasPricing';
import { defaultNodeBox, type CanvasEdge, type CanvasGroupParams, type CanvasNode, type CanvasNodeType } from '../../../shared/canvas';
import { extractSubgraph, formatSubgraphForPrompt } from '../../../shared/canvasSubgraph';
import { nodeReadinessIssues } from '../../../shared/canvasReadiness';
import { OPEN_HANDLE_MENU_EVENT, type HandleMenuEventDetail } from './MagneticHandle';
import { openImageEdit } from './imageEdit/openImageEdit';
import ImageNode, { type CanvasNodeData } from './ImageNode';
import AgentNode from './AgentNode';
import VideoNode from './VideoNode';
import AudioNode from './AudioNode';
import NoteNode from './NoteNode';
import GroupNode from './GroupNode';
import AnchorNode from './AnchorNode';
import RerouteNode from './RerouteNode';
import FrameExtractorNode from './FrameExtractorNode';
import SectionNode from './SectionNode';
import SubgraphNode from './SubgraphNode';
import ProposalBar from './ProposalBar';
import { AlignmentGuides } from './AlignmentGuides';
import AssetShelf from './AssetShelf';
import AgentActivityStrip from './AgentActivityStrip';
import StoryboardModal from './StoryboardModal';
import CuttableEdge from './edges/CuttableEdge';
import AddNodesModal from './AddNodesModal';
import CanvasContextMenu from './CanvasContextMenu';
import CanvasEmptyPrompt from './CanvasEmptyPrompt';
import ReturnToNodesToast from './ReturnToNodesToast';
import MultiSelectToolbar from './MultiSelectToolbar';
import InsertFromCanvasBanner from './InsertFromCanvasBanner';
import { getCanvasNodeThumbnail } from './canvasThumbnail';
import ErrorBoundary from '../ErrorBoundary';
import Tooltip from '../ui/Tooltip';
import { motion, AnimatePresence } from 'motion/react';
import { canvasAssetUrlSync } from '../../api';

const NODE_TYPES: NodeTypes = {
  image: ImageNode,
  agent: AgentNode,
  video: VideoNode,
  audio: AudioNode,
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
  if (n.type === 'audio') return '#f59e0b';
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
  // Smart alignment guides & magnetic snapping (can be toggled in top-left rail).
  const [snapEnabled, setSnapEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('reizo:canvas-snap-enabled');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
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

  const toggleSnap = useCallback(() => {
    setSnapEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('reizo:canvas-snap-enabled', String(next));
      } catch {
        /* ignore */
      }
      flash(next ? '🧲 智能对齐与磁吸吸附已开启' : '智能对齐与磁吸吸附已关闭');
      return next;
    });
  }, [flash]);

  // TapNow-style workflow edges visibility toggle and hover reveal.
  const [wiresVisible, setWiresVisible] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('reizo:canvas-wires-visible');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const isPickingReference = useChatStore((s) => (sessionId ? s.pickingReferenceBySession[sessionId] : false)) ?? false;

  useEffect(() => {
    const handleClear = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId?: string }>).detail;
      if (!detail?.sessionId || detail.sessionId === sessionId) {
        rf.setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
        setSelectedNodeIds([]);
      }
    };
    const handleDeselect = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId?: string; nodeId?: string }>).detail;
      if (detail?.nodeId && (!detail.sessionId || detail.sessionId === sessionId)) {
        rf.setNodes((nds) =>
          nds.map((n) => (n.id === detail.nodeId && n.selected ? { ...n, selected: false } : n)),
        );
        setSelectedNodeIds((prev) => prev.filter((id) => id !== detail.nodeId));
      }
    };
    window.addEventListener('reizo:clear-canvas-selection', handleClear);
    window.addEventListener('reizo:deselect-canvas-node', handleDeselect);
    return () => {
      window.removeEventListener('reizo:clear-canvas-selection', handleClear);
      window.removeEventListener('reizo:deselect-canvas-node', handleDeselect);
    };
  }, [sessionId, rf]);

  const toggleWires = useCallback(() => {
    setWiresVisible((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('reizo:canvas-wires-visible', String(next));
      } catch {
        /* ignore */
      }
      flash(next ? '连线已显示' : '连线已隐藏 (悬停节点可穿透透视)');
      return next;
    });
  }, [flash]);

  useEffect(() => {
    void canvasStore.openCanvas(sessionId).catch((): void => undefined);
    return () => canvasStore.closeCanvas(sessionId);
  }, [sessionId]);

  const lastSpotAtRef = useRef<number>(0);
  const storeNodesRef = useRef(storeNodes);
  storeNodesRef.current = storeNodes;

  // The agent touched node(s) or user clicked focus -> pan (one) or fit (many) and pulse a highlight.
  // CRITICAL: Only run once per new spotlight event (spot.at). NEVER re-run when storeNodes changes (e.g. after dragging a node)!
  useEffect(() => {
    if (!spot || spot.ids.length === 0 || !spot.at || spot.at <= lastSpotAtRef.current) return;
    lastSpotAtRef.current = spot.at;

    const currentNodes = storeNodesRef.current;
    const present = spot.ids.filter((id) => currentNodes.some((n) => n.id === id));
    if (present.length === 0) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const one = present.length === 1 ? currentNodes.find((n) => n.id === present[0]) : null;
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
  }, [spot?.at, rf]);

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
  const currentZoom = useStore((s) => Math.round((s.transform[2] || 1) * 100));

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
        const isRevealed =
          wiresVisible ||
          hoveredNodeId === edge.sourceId ||
          hoveredNodeId === edge.targetId ||
          selectedNodeIds.includes(edge.sourceId) ||
          selectedNodeIds.includes(edge.targetId);
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
            isRevealed,
            onCutEdge: handleCutEdge,
            onRerouteEdge: handleRerouteEdge,
          },
        };
      }),
    [storeEdges, nodeMetaMap, wiresVisible, hoveredNodeId, selectedNodeIds, handleCutEdge, handleRerouteEdge],
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

  const connectingNode = useRef<{ nodeId: string; handleId: string | null; handleType: 'source' | 'target' } | null>(null);
  const [dropConnectMenu, setDropConnectMenu] = useState<{
    nodeId: string;
    handleId: string | null;
    handleType: 'source' | 'target';
    flowX: number;
    flowY: number;
    screenX: number;
    screenY: number;
    isDragDrop?: boolean;
  } | null>(null);
  const dropConnectMenuOpenedAt = useRef<number>(0);
  const [addNodesModal, setAddNodesModal] = useState<{
    x: number;
    y: number;
    flowX: number;
    flowY: number;
  } | null>(null);
  const addNodesModalOpenedAt = useRef<number>(0);

  const openAddNodesModal = useCallback(
    (screenX: number, screenY: number, flowX?: number, flowY?: number) => {
      if (menu) setMenu(null);
      addNodesModalOpenedAt.current = Date.now();
      const flow =
        flowX !== undefined && flowY !== undefined
          ? { x: flowX, y: flowY }
          : rf.screenToFlowPosition({ x: screenX, y: screenY });
      setAddNodesModal({
        x: screenX,
        y: screenY,
        flowX: Math.round(flow.x),
        flowY: Math.round(flow.y),
      });
    },
    [rf, menu],
  );

  const selectNode = useCallback(
    (nodeId: string) => {
      rf.setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          selected: n.id === nodeId,
        })),
      );
      setSelectedNodeIds([nodeId]);
      canvasStore.setSelection(sessionId, [nodeId]);
    },
    [rf, sessionId],
  );

  const handleCreateAndSelect = useCallback(
    async (promise: Promise<string | null>) => {
      setDropConnectMenu(null);
      const newId = await promise;
      if (newId) {
        setTimeout(() => {
          selectNode(newId);
        }, 50);
      }
    },
    [selectNode],
  );

  const handleUploadFileAt = useCallback(
    async (file: File, pos: { x: number; y: number }) => {
      try {
        if (file.type.startsWith('image/')) {
          await canvasStore.importImage(sessionId, file, pos);
          flash('已导入图片节点');
        } else if (file.type.startsWith('video/')) {
          const newNodeId = await canvasStore.addNode(sessionId, 'video', pos);
          if (newNodeId) {
            await canvasStore.uploadAssetToNode(sessionId, newNodeId, file);
            selectNode(newNodeId);
            flash('已导入视频节点');
          }
        } else if (file.type.startsWith('audio/')) {
          const newNodeId = await canvasStore.addNode(sessionId, 'audio', pos);
          if (newNodeId) {
            await canvasStore.uploadAssetToNode(sessionId, newNodeId, file);
            selectNode(newNodeId);
            flash('已导入音频节点');
          }
        } else {
          const text = await file.text();
          const newNodeId = await canvasStore.addNode(sessionId, 'note', pos);
          if (newNodeId) {
            await canvasStore.updateNodeParams(sessionId, newNodeId, { content: text });
            selectNode(newNodeId);
            flash('已导入文本节点');
          }
        }
      } catch (err: unknown) {
        flash(err instanceof Error ? err.message : '导入失败');
      }
    },
    [sessionId, flash, selectNode],
  );

  const paneFileInputRef = useRef<HTMLInputElement>(null);
  const paneUploadTargetPosRef = useRef<{ x: number; y: number } | null>(null);
  const copiedNodesRef = useRef<Array<{
    type: CanvasNodeType;
    title?: string;
    w?: number;
    h?: number;
    params?: unknown;
  }> | null>(null);

  const handleCopyNodes = useCallback(
    (nodeIds: string[]) => {
      const nodesToCopy = storeNodes.filter((n) => nodeIds.includes(n.id));
      if (nodesToCopy.length === 0) return;
      copiedNodesRef.current = nodesToCopy.map((n) => ({
        type: n.type,
        title: n.title,
        w: n.w,
        h: n.h,
        params: n.params ? JSON.parse(JSON.stringify(n.params)) : undefined,
      }));
      try {
        void navigator.clipboard?.writeText(
          JSON.stringify({ reizoNodes: copiedNodesRef.current }, null, 2),
        );
      } catch {
        /* ignore */
      }
      flash(nodesToCopy.length === 1 ? '已复制节点 (Ctrl+C)' : `已复制 ${nodesToCopy.length} 个节点`);
    },
    [storeNodes, flash],
  );

  const handlePasteAt = useCallback(
    async (targetPos?: { x: number; y: number }) => {
      const pos =
        targetPos ??
        (() => {
          const cx = window.innerWidth / 2;
          const cy = window.innerHeight / 2;
          const flow = rf.screenToFlowPosition({ x: cx, y: cy });
          return { x: Math.round(flow.x), y: Math.round(flow.y) };
        })();

      // 1. Try copiedNodesRef first
      if (copiedNodesRef.current && copiedNodesRef.current.length > 0) {
        const newIds: string[] = [];
        for (let i = 0; i < copiedNodesRef.current.length; i++) {
          const item = copiedNodesRef.current[i];
          const newId = await canvasStore.addNode(
            sessionId,
            item.type,
            { x: pos.x + i * 40, y: pos.y + i * 40 },
            item.params as Record<string, unknown>,
          );
          if (newId) newIds.push(newId);
        }
        if (newIds.length > 0) {
          setSelectedNodeIds(newIds);
          canvasStore.setSelection(sessionId, newIds);
          flash(`已粘贴 ${newIds.length} 个节点`);
          return;
        }
      }

      // 2. Try OS clipboard
      try {
        if (navigator.clipboard) {
          const items: ClipboardItem[] = await navigator.clipboard.read().catch((): ClipboardItem[] => []);
          for (const item of items) {
            const imageType = item.types.find((t: string) => t.startsWith('image/'));
            if (imageType) {
              const blob = await item.getType(imageType);
              const file = new File([blob], 'pasted-image.png', { type: imageType });
              await handleUploadFileAt(file, pos);
              return;
            }
          }
          const text = await navigator.clipboard.readText().catch((): string => '');
          if (text) {
            try {
              const parsed = JSON.parse(text);
              if (parsed && Array.isArray(parsed.reizoNodes)) {
                const newIds: string[] = [];
                for (let i = 0; i < parsed.reizoNodes.length; i++) {
                  const n = parsed.reizoNodes[i];
                  const newId = await canvasStore.addNode(
                    sessionId,
                    n.type,
                    { x: pos.x + i * 40, y: pos.y + i * 40 },
                    n.params,
                  );
                  if (newId) newIds.push(newId);
                }
                if (newIds.length > 0) {
                  setSelectedNodeIds(newIds);
                  canvasStore.setSelection(sessionId, newIds);
                  flash(`已粘贴 ${newIds.length} 个节点`);
                  return;
                }
              }
            } catch {
              /* not json */
            }
            const newId = await canvasStore.addNode(sessionId, 'note', pos, { content: text } as Record<string, unknown>);
            if (newId) {
              selectNode(newId);
              flash('已粘贴文本便签');
              return;
            }
          }
        }
      } catch {
        /* ignore */
      }
    },
    [rf, sessionId, handleUploadFileAt, flash, selectNode],
  );

  const selectedNodes = useMemo(
    () => storeNodes.filter((n) => selectedNodeIds.includes(n.id)),
    [storeNodes, selectedNodeIds],
  );

  const addSelectedToComposer = useCallback(() => {
    if (selectedNodes.length === 0) return;
    for (const node of selectedNodes) {
      const p = (node.params as Record<string, unknown>) ?? {};
      const label = (node.title || p.prompt || p.instruction || p.content || node.type).toString().slice(0, 24);
      const thumbnail = getCanvasNodeThumbnail(node) || (p.imageUrl as string | undefined) || (p.videoUrl as string | undefined);
      chatStore.addNodeRef(sessionId, { id: node.id, label, type: node.type, thumbnail });
    }
    flash(`已将 ${selectedNodes.length} 个节点加入对话引用`);
  }, [sessionId, selectedNodes, flash]);

  const createGroupFromSelection = useCallback(async () => {
    if (selectedNodes.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of selectedNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n.w || 260));
      maxY = Math.max(maxY, n.y + (n.h || 180));
    }
    const padding = 36;
    const groupId = await canvasStore.addNode(sessionId, 'group', {
      x: Math.round(minX - padding),
      y: Math.round(minY - padding - 24),
    });
    if (groupId) {
      void canvasStore.commitResize(
        sessionId,
        groupId,
        { w: 320, h: 240 },
        {
          w: Math.round(maxX - minX + padding * 2),
          h: Math.round(maxY - minY + padding * 2 + 24),
        },
      );
      void canvasStore.updateNodeParams(sessionId, groupId, {
        memberIds: selectedNodes.map((n) => n.id),
        color: '#3b82f6',
      });
      selectNode(groupId);
      flash(`已创建包含 ${selectedNodes.length} 个节点的编组`);
    }
  }, [sessionId, selectedNodes, selectNode, flash]);

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
        if (isPickingReference) {
          chatStore.setPickingReference(sessionId, false);
          return;
        }
      }

      // Alt+W -> Toggle Workflow Wires
      if (!isInput && e.altKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        toggleWires();
        return;
      }

      // Ctrl/Cmd+G -> Create Group from selection
      if (!isInput && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && !e.shiftKey) {
        e.preventDefault();
        void createGroupFromSelection();
        return;
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
          void handleCreateAndSelect(
            canvasStore.addNodeAndConnect(
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
            ),
          );
        } else if (key === 'v') {
          if (srcNode.type === 'image') {
            void canvasStore.animateFromImage(sessionId, srcNode.id);
          } else {
            void handleCreateAndSelect(
              canvasStore.addNodeAndConnect(
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
              ),
            );
          }
        } else if (key === 't') {
          void handleCreateAndSelect(
            canvasStore.addNodeAndConnect(
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
            ),
          );
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sessionId, searchOpen, selectedNodeIds, storeNodes, flash, handleCreateAndSelect]);

  const lastConnectTimeRef = useRef<number>(0);

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
    (event: MouseEvent | TouchEvent, connectionState?: any) => {
      const source = connectingNode.current;
      connectingNode.current = null;

      // If a connection just completed or is already valid: NEVER open the creation menu!
      if (Date.now() - lastConnectTimeRef.current < 500) return;
      if (connectionState?.toHandle || connectionState?.isValid === true) return;

      const fromNodeId = connectionState?.fromNode?.id ?? source?.nodeId;
      const fromHandleId = connectionState?.fromHandle?.id ?? source?.handleId ?? null;
      const fromHandleType = (connectionState?.fromHandle?.type as 'source' | 'target') ?? source?.handleType ?? 'source';

      if (!fromNodeId) return;

      // Determine client coordinates of the drop release
      let clientX = 0;
      let clientY = 0;
      if ('clientX' in event && typeof (event as MouseEvent).clientX === 'number') {
        clientX = (event as MouseEvent).clientX;
        clientY = (event as MouseEvent).clientY;
      } else if ('changedTouches' in event && (event as TouchEvent).changedTouches?.length) {
        clientX = (event as TouchEvent).changedTouches[0].clientX;
        clientY = (event as TouchEvent).changedTouches[0].clientY;
      } else if ('touches' in event && (event as TouchEvent).touches?.length) {
        clientX = (event as TouchEvent).touches[0].clientX;
        clientY = (event as TouchEvent).touches[0].clientY;
      }

      // CRITICAL: Inspect the physical element under the drop cursor via document.elementFromPoint
      // (event.target in mouseup during a drag is often the window or the source handle, NOT the target)
      const elUnderCursor = clientX && clientY ? (document.elementFromPoint(clientX, clientY) as HTMLElement | null) : null;
      const targetEl = elUnderCursor || (event.target as HTMLElement | null);

      // 1. Check if dropped on a magnetic handle
      const magneticHandleEl = targetEl?.closest?.('[data-magnetic-handle="true"]') as HTMLElement | null;
      const targetHandleNodeId = magneticHandleEl?.getAttribute('data-node-id');
      const targetHandleType = magneticHandleEl?.getAttribute('data-handle-type') as 'source' | 'target' | null;
      const targetHandleId = magneticHandleEl?.getAttribute('data-handle-id') || null;

      // 2. Check if dropped onto another existing node: connect to that node directly without any popup!
      const targetNodeEl = targetEl?.closest?.('.react-flow__node');
      const targetNodeId = targetHandleNodeId || targetNodeEl?.getAttribute('data-id');

      if (targetNodeId && targetNodeId !== fromNodeId) {
        const isBackward = fromHandleType === 'target';
        const sourceId = isBackward ? targetNodeId : fromNodeId;
        const targetId = isBackward ? fromNodeId : targetNodeId;
        const sourceHandle = isBackward ? targetHandleId : fromHandleId;
        const targetHandle = isBackward ? fromHandleId : targetHandleId;

        const srcNode = storeNodes.find((n) => n.id === sourceId);
        const tgtNode = storeNodes.find((n) => n.id === targetId);

        if (srcNode && tgtNode) {
          const compat = isPortCompatible(srcNode, tgtNode, sourceHandle, targetHandle);
          if (compat.valid) {
            lastConnectTimeRef.current = Date.now();
            void canvasStore
              .connectNodes(sessionId, sourceId, targetId, sourceHandle, targetHandle)
              .then(() => {
                flash(`已连接至「${tgtNode.title || '目标节点'}」`);
              })
              .catch((err: unknown) => {
                flash(err instanceof Error ? err.message : '连接失败');
              });
            return;
          } else {
            flash(compat.reason || '不支持该类型的端口连线');
            return;
          }
        }
      }

      // 3. If dropped on any handle element: connection is handled by onConnect or ignored; do not open menu
      if (
        targetEl &&
        targetEl.closest &&
        (targetEl.closest('.react-flow__handle') ||
          targetEl.closest('.magnetic-handle-wrapper') ||
          targetEl.closest('[data-magnetic-handle]') ||
          targetEl.closest('[data-handleid]'))
      ) {
        return;
      }

      // 4. Otherwise: dropped on empty canvas space -> open the drop-to-create menu at cursor
      const flowPos = rf.screenToFlowPosition({ x: clientX, y: clientY });

      dropConnectMenuOpenedAt.current = Date.now();

      setDropConnectMenu({
        nodeId: fromNodeId,
        handleId: fromHandleId,
        handleType: fromHandleType,
        flowX: Math.round(flowPos.x),
        flowY: Math.round(flowPos.y),
        screenX: Math.round(clientX),
        screenY: Math.round(clientY),
        isDragDrop: true,
      });
    },
    [rf, sessionId, storeNodes, flash],
  );

  // Listen for clicks on TapNow magnetic plus handles to open downstream creation or upstream context menu
  useEffect(() => {
    const onOpenHandleMenu = (e: Event) => {
      // If a drag connection just finished, ignore opening menu
      if (Date.now() - lastConnectTimeRef.current < 500) return;

      const detail = (e as CustomEvent<HandleMenuEventDetail>).detail;
      if (!detail) return;
      const anchorNode = storeNodes.find((n) => n.id === detail.nodeId);
      const isRight = detail.handleType === 'source';
      const defaultFlowX = anchorNode
        ? isRight
          ? anchorNode.x + anchorNode.w + 60
          : anchorNode.x - 340
        : detail.flowX;
      const defaultFlowY = anchorNode ? anchorNode.y : detail.flowY;

      dropConnectMenuOpenedAt.current = Date.now();

      setDropConnectMenu({
        nodeId: detail.nodeId,
        handleId: detail.handleId,
        handleType: detail.handleType,
        flowX: defaultFlowX,
        flowY: defaultFlowY,
        screenX: detail.screenX,
        screenY: detail.screenY,
        isDragDrop: false,
      });
    };
    window.addEventListener(OPEN_HANDLE_MENU_EVENT, onOpenHandleMenu);
    return () => window.removeEventListener(OPEN_HANDLE_MENU_EVENT, onOpenHandleMenu);
  }, [storeNodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      lastConnectTimeRef.current = Date.now();
      connectingNode.current = null;
      if (!connection.source || !connection.target) return;
      const srcNode = storeNodes.find((n) => n.id === connection.source);
      const tgtNode = storeNodes.find((n) => n.id === connection.target);
      if (srcNode && tgtNode) {
        const compat = isPortCompatible(srcNode, tgtNode, connection.sourceHandle, connection.targetHandle);
        if (!compat.valid) {
          flash(compat.reason || '不支持该类型的端口连线');
          return;
        }
      }
      void canvasStore
        .connectNodes(sessionId, connection.source, connection.target, connection.sourceHandle, connection.targetHandle)
        .then(() => {
          flash(`已连接至「${tgtNode?.title || '目标节点'}」`);
        })
        .catch((err: unknown) => {
          flash(err instanceof Error ? err.message : '连接失败');
        });
    },
    [sessionId, flash, storeNodes],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      if (storeEdges.some((e) => e.sourceId === c.source && e.targetId === c.target)) return false;
      if (wouldCycle(storeEdges, c.source, c.target)) return false;
      const srcNode = storeNodes.find((n) => n.id === c.source);
      const tgtNode = storeNodes.find((n) => n.id === c.target);
      if (srcNode && tgtNode) {
        const compat = isPortCompatible(srcNode, tgtNode, c.sourceHandle, c.targetHandle);
        if (!compat.valid) return false;
      }
      return true;
    },
    [storeEdges, storeNodes],
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
    const p = (node.params as Record<string, unknown>) ?? {};
    const label = (node.title || p.prompt || p.instruction || p.content || node.type).toString().slice(0, 24);
    const thumbnail = getCanvasNodeThumbnail(node) || (p.imageUrl as string | undefined) || (p.videoUrl as string | undefined);
    chatStore.addNodeRef(sessionId, { id: nodeId, label, type: node.type, thumbnail });
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
        } else if (k === 'c' && !isInput && selectedNodeIds.length > 0) {
          e.preventDefault();
          handleCopyNodes(selectedNodeIds);
        } else if (k === 'v' && !isInput) {
          e.preventDefault();
          void handlePasteAt();
        } else if (k === 'a' && !isInput) {
          e.preventDefault();
          const allIds = storeNodes.map((n) => n.id);
          setSelectedNodeIds(allIds);
          canvasStore.setSelection(sessionId, allIds);
        } else if (k === '=' || k === '+') {
          e.preventDefault();
          rf.zoomIn({ duration: 150 });
        } else if (k === '-' || k === '_') {
          e.preventDefault();
          rf.zoomOut({ duration: 150 });
        } else if (k === '0') {
          e.preventDefault();
          rf.zoomTo(1, { duration: 150 });
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
    [sessionId, storeNodes, selectedNodeIds, rf, flash, zoomToSelection, handleCopyNodes, handlePasteAt],
  );

  return (
    <div
      data-dragging={isInteracting ? 'true' : undefined}
      data-lowzoom={isLowZoom ? 'true' : undefined}
      className={cn("h-full w-full outline-none", isPickingReference && "!cursor-crosshair")}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onClick={() => {
        if (Date.now() - dropConnectMenuOpenedAt.current < 350) return;
        if (Date.now() - addNodesModalOpenedAt.current < 350) return;
        if (menu) setMenu(null);
        if (dropConnectMenu) setDropConnectMenu(null);
        if (addNodesModal) setAddNodesModal(null);
        if (openTool) setOpenTool(null);
      }}
    >
      <ReactFlow
        defaultNodes={initialNodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        connectionMode={ConnectionMode.Loose}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeClick={(_, rfNode) => {
          if (isPickingReference) {
            const node = storeNodes.find((n) => n.id === rfNode.id);
            if (node) {
              const p = (node.params as Record<string, unknown>) ?? {};
              const label = (node.title || p.prompt || p.instruction || p.content || node.type).toString().slice(0, 24);
              const thumbnail = getCanvasNodeThumbnail(node) || (p.imageUrl as string | undefined) || (p.videoUrl as string | undefined);
              chatStore.addNodeRef(sessionId, { id: node.id, label, type: node.type, thumbnail });
              flash(`已添加引用: ${label}`);
            }
          }
        }}
        onPaneClick={() => {
          if (Date.now() - dropConnectMenuOpenedAt.current < 350) return;
          if (Date.now() - addNodesModalOpenedAt.current < 350) return;
          if (menu) setMenu(null);
          if (dropConnectMenu) setDropConnectMenu(null);
          if (addNodesModal) setAddNodesModal(null);
        }}
        isValidConnection={isValidConnection}
        onSelectionChange={onSelectionChange}
        onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
        onNodeMouseLeave={() => setHoveredNodeId(null)}
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
          if (addNodesModal) setAddNodesModal(null);
          setMenu({ kind: 'node', x: e.clientX, y: e.clientY, nodeId: node.id });
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          const pe = e as unknown as MouseEvent;
          const flow = rf.screenToFlowPosition({ x: pe.clientX, y: pe.clientY });
          if (menu) setMenu(null);
          openAddNodesModal(pe.clientX, pe.clientY, flow.x, flow.y);
        }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Backspace', 'Delete']}
        panActivationKeyCode="Space"
        panOnDrag={mode === 'marquee' ? [1] : true}
        selectionOnDrag={mode === 'marquee'}
        panOnScroll={navMode === 'trackpad'}
        zoomOnScroll={navMode === 'mouse'}
        zoomOnPinch={true}
        zoomOnDoubleClick={false}
        minZoom={0.05}
        maxZoom={3.0}
        className="bg-paper"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.5}
          color="var(--canvas-dot, rgba(255, 255, 255, 0.22))"
        />
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
        <AlignmentGuides sessionId={sessionId} enabled={snapEnabled} />
        <ReturnToNodesToast sessionId={sessionId} />
        <InsertFromCanvasBanner sessionId={sessionId} />
        <MultiSelectToolbar
          sessionId={sessionId}
          selectedNodes={selectedNodes}
          onAddToChat={addSelectedToComposer}
          onGroup={createGroupFromSelection}
          onRunSelected={() => {
            const runnables = selectedNodes.filter((n) =>
              ['image', 'video', 'agent', 'music', 'sound'].includes(n.type),
            );
            if (runnables.length === 0) {
              flash('选中节点中无待执行节点');
              return;
            }
            for (const n of runnables) {
              void canvasStore.runNode(sessionId, n.id);
            }
            flash(`已启动执行 ${runnables.length} 个节点`);
          }}
          onDelete={() => {
            for (const n of selectedNodes) {
              void canvasStore.removeNode(sessionId, n.id);
            }
            flash(`已删除 ${selectedNodes.length} 个节点`);
          }}
        />

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
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center select-none">
            <CanvasEmptyPrompt
              onOpenAddModal={() => {
                const cx = window.innerWidth / 2;
                const cy = window.innerHeight / 2;
                openAddNodesModal(cx, Math.max(80, cy - 140));
              }}
              onCreateTextToVideo={() => {
                const cx = window.innerWidth / 2;
                const cy = window.innerHeight / 2;
                const flow = rf.screenToFlowPosition({ x: cx, y: cy });
                void canvasStore
                  .addNode(
                    sessionId,
                    'video',
                    { x: Math.round(flow.x - 170), y: Math.round(flow.y - 100) },
                    { prompt: '' } as Record<string, unknown>,
                  )
                  .then(() => {
                    flash('已创建「文字生视频」卡片');
                  });
              }}
              onCreateImageNode={() => {
                const cx = window.innerWidth / 2;
                const cy = window.innerHeight / 2;
                const flow = rf.screenToFlowPosition({ x: cx, y: cy });
                void canvasStore
                  .addNode(
                    sessionId,
                    'image',
                    { x: Math.round(flow.x - 160), y: Math.round(flow.y - 100) },
                    { prompt: '' } as Record<string, unknown>,
                  )
                  .then(() => {
                    flash('已创建「图片换背景」卡片');
                  });
              }}
              onCreateFirstFrameToVideo={async () => {
                const cx = window.innerWidth / 2;
                const cy = window.innerHeight / 2;
                const flow = rf.screenToFlowPosition({ x: cx, y: cy });
                const startX = Math.round(flow.x - 360);
                const startY = Math.round(flow.y - 120);
                const imageId = await canvasStore.addNode(
                  sessionId,
                  'image',
                  { x: startX, y: startY },
                  { prompt: '电影首帧概念设计，35mm 胶片质感，冷暖对比光影，8k' } as Record<string, unknown>,
                );
                const videoId = await canvasStore.addNode(
                  sessionId,
                  'video',
                  { x: startX + 380, y: startY },
                  { prompt: '镜头向前平滑推近，环境光微动' } as Record<string, unknown>,
                );
                if (imageId && videoId) {
                  await canvasStore.connectNodes(sessionId, imageId, videoId, 'output', 'start_frame');
                }
                flash('已创建「首帧生成视频」流水线');
                setTimeout(() => rf.fitView({ padding: 0.25, duration: 300 }), 120);
              }}
              onCreateAudioToVideo={async () => {
                const cx = window.innerWidth / 2;
                const cy = window.innerHeight / 2;
                const flow = rf.screenToFlowPosition({ x: cx, y: cy });
                const startX = Math.round(flow.x - 340);
                const startY = Math.round(flow.y - 100);
                const audioId = await canvasStore.addNode(sessionId, 'audio', { x: startX, y: startY });
                const videoId = await canvasStore.addNode(sessionId, 'video', { x: startX + 380, y: startY });
                if (audioId && videoId) {
                  await canvasStore.connectNodes(sessionId, audioId, videoId, 'output', 'reference');
                }
                flash('已创建「音频生视频」卡片');
                setTimeout(() => rf.fitView({ padding: 0.25, duration: 300 }), 120);
              }}
              onLoadTemplate={() => {
                void canvasStore.loadStarterFlow(sessionId).then(() => {
                  flash('已载入「雨夜霓虹街头」影视分镜工作流');
                  setTimeout(() => rf.fitView({ padding: 0.2, duration: 400 }), 150);
                });
              }}
            />
          </div>
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
              { icon: <Type size={13} />, label: '文本便签', onClick: () => addNode('note') },
              { icon: <Volume2 size={13} />, label: '音频播放', onClick: () => addNode('audio') },
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
          <button
            type="button"
            onClick={toggleSnap}
            className={cn(
              'canvas-tool !px-1.5 transition-colors',
              snapEnabled
                ? '!border-accent/50 !bg-accent/15 !text-accent'
                : 'text-ink-muted/60 hover:text-ink',
            )}
            title={
              snapEnabled
                ? '智能对齐与磁吸吸附已开启 (点击关闭)'
                : '智能对齐与磁吸吸附已关闭 (点击开启)'
            }
          >
            <Magnet size={13} />
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
              active={wiresVisible}
              onClick={toggleWires}
              title={
                wiresVisible
                  ? '连线可见 (Alt+W 点击隐藏，隐藏后悬停节点可穿透透视)'
                  : '连线已隐藏 (Alt+W 点击显示)'
              }
            >
              <Workflow size={14} />
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
            <NavButton onClick={() => rf.zoomOut({ duration: 150 })} title="缩小 (Ctrl + -)">
              <ZoomOut size={14} />
            </NavButton>
            <Tooltip content="重置为 100% (Ctrl+0)" side="top">
              <button
                type="button"
                onClick={() => rf.zoomTo(1, { duration: 150 })}
                className="flex h-7 min-w-[42px] items-center justify-center rounded-lg px-1 text-[11px] font-mono font-medium text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink select-none"
              >
                {currentZoom}%
              </button>
            </Tooltip>
            <NavButton onClick={() => rf.zoomIn({ duration: 150 })} title="放大 (Ctrl + +)">
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
        <CanvasContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onUploadClick={() => {
            if (menu.kind === 'pane') {
              paneUploadTargetPosRef.current = { x: menu.flowX, y: menu.flowY };
              paneFileInputRef.current?.click();
            }
          }}
          onAddAssetClick={() => {
            if (menu.kind === 'pane') {
              void canvasStore
                .addNode(sessionId, 'anchor', { x: menu.flowX, y: menu.flowY }, {
                  role: 'character',
                  label: '资产图钉',
                } as Record<string, unknown>)
                .then((id) => {
                  if (id) {
                    selectNode(id);
                    flash('已添加资产图钉');
                  }
                });
            }
          }}
          onOpenAddNodesModal={() => {
            if (menu.kind === 'pane') {
              setAddNodesModal({
                x: menu.x,
                y: menu.y,
                flowX: menu.flowX,
                flowY: menu.flowY,
              });
            }
          }}
          onAddNode={(type, initialParams) => {
            if (menu.kind === 'pane') {
              void canvasStore
                .addNode(sessionId, type, { x: menu.flowX, y: menu.flowY }, initialParams as Record<string, unknown>)
                .then((id) => {
                  if (id) selectNode(id);
                });
            }
          }}
          onOpenTimeline={() => setShowStoryboard(true)}
          onOpen3DStudio={() => {
            if (menu.kind === 'pane') {
              void canvasStore
                .addNode(sessionId, 'section', { x: menu.flowX, y: menu.flowY }, {
                  title: '3D 片场',
                  description: '场景多机位与空间编排',
                } as Record<string, unknown>)
                .then((id) => {
                  if (id) selectNode(id);
                });
            }
          }}
          onTidyLayout={tidy}
          onFitView={() => rf.fitView({ padding: 0.2, duration: 200 })}
          onUndo={() => {
            void canvasStore.undo(sessionId);
          }}
          onRedo={() => {
            void canvasStore.redo(sessionId);
          }}
          onPaste={() => {
            if (menu.kind === 'pane') {
              void handlePasteAt({ x: menu.flowX, y: menu.flowY });
            }
          }}
          canUndo={Boolean(history?.canUndo)}
          canRedo={Boolean(history?.canRedo)}
          canPaste={true}
          onRunNode={(nodeId) => void canvasStore.runNode(sessionId, nodeId)}
          onRunGraph={(nodeId) => void canvasStore.runGraph(sessionId, nodeId)}
          onForkNode={(nodeId) => void canvasStore.forkNode(sessionId, nodeId)}
          onAskAgent={askAgent}
          onRefToComposer={refToComposer}
          onCopyNode={(nodeId) => handleCopyNodes([nodeId])}
          onDeleteNode={(nodeId) => void canvasStore.removeNode(sessionId, nodeId)}
          canEditImage={
            menu.kind === 'node' &&
            storeNodes.find((n) => n.id === menu.nodeId)?.type === 'image' &&
            (storeNodes.find((n) => n.id === menu.nodeId)?.output?.assets?.length ?? 0) > 0
          }
          onEditImage={(nodeId, kind) => {
            openImageEdit({ sessionId, nodeId, kind, commitMode: 'derive' });
          }}
        />
      ) : null}

      {dropConnectMenu ? (
        <div
          className="fixed z-[180] flex w-[250px] flex-col rounded-2xl border border-line/60 bg-[#161618]/95 p-2 text-xs shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 select-none cursor-default"
          style={{
            left: Math.max(16, Math.min(dropConnectMenu.screenX, window.innerWidth - 266)),
            top: Math.max(16, Math.min(dropConnectMenu.screenY, window.innerHeight - 300)),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const anchorNode = storeNodes.find((n) => n.id === dropConnectMenu.nodeId);
            const isBackward = dropConnectMenu.handleType === 'target';
            const nodeTitle = anchorNode?.title || (anchorNode?.type === 'image' ? '图片' : anchorNode?.type === 'video' ? '视频' : anchorNode?.type === 'audio' ? '音频' : '节点');

            const getSpawnPos = (type: CanvasNodeType) => {
              const box = defaultNodeBox(type);
              if (dropConnectMenu.isDragDrop) {
                if (isBackward) {
                  return {
                    x: Math.round(dropConnectMenu.flowX - box.w),
                    y: Math.round(dropConnectMenu.flowY - box.h / 2),
                  };
                } else {
                  return {
                    x: Math.round(dropConnectMenu.flowX),
                    y: Math.round(dropConnectMenu.flowY - box.h / 2),
                  };
                }
              } else {
                // Clicked plus handle directly without dragging: generous spacing for clean layout
                if (isBackward) {
                  const anchor = anchorNode || { x: dropConnectMenu.flowX, y: dropConnectMenu.flowY, w: 320 };
                  return {
                    x: Math.round(anchor.x - box.w - 120),
                    y: Math.round(anchor.y),
                  };
                } else {
                  const anchor = anchorNode || { x: dropConnectMenu.flowX, y: dropConnectMenu.flowY, w: 320 };
                  return {
                    x: Math.round(anchor.x + anchor.w + 140),
                    y: Math.round(anchor.y),
                  };
                }
              }
            };

            if (isBackward) {
              return (
                <>
                  <div className="flex items-center justify-between px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-muted/70">
                    <span>接入上游输入源 (Input)</span>
                    <span className="text-[10px] text-accent/80 truncate max-w-[80px]">➔ {nodeTitle}</span>
                  </div>

                  <div className="flex flex-col gap-0.5 mt-1">
                    <button
                      type="button"
                      onClick={() => {
                        void handleCreateAndSelect(
                          canvasStore.addNodeAndConnectToTarget(
                            sessionId,
                            {
                              type: 'note',
                              ...getSpawnPos('note'),
                              title: '提示词',
                            },
                            dropConnectMenu.nodeId,
                            'prompt',
                            'prompt_out',
                          ),
                        );
                      }}
                      className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 group-hover:bg-emerald-500/25 transition-colors">
                        <Type size={14} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-medium text-ink group-hover:text-white">Text / 提示词</span>
                        <span className="text-[10px] text-ink-muted truncate">提供提示词或剧本文本</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void handleCreateAndSelect(
                          canvasStore.addNodeAndConnectToTarget(
                            sessionId,
                            {
                              type: 'image',
                              ...getSpawnPos('image'),
                              title: '参考图',
                            },
                            dropConnectMenu.nodeId,
                            'prompt',
                            'image_out',
                          ),
                        );
                      }}
                      className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400 group-hover:bg-indigo-500/25 transition-colors">
                        <ImageIcon size={14} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-medium text-ink group-hover:text-white">Image / 参考图</span>
                        <span className="text-[10px] text-ink-muted truncate">提供首帧或画面参考</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void handleCreateAndSelect(
                          canvasStore.addNodeAndConnectToTarget(
                            sessionId,
                            {
                              type: 'video',
                              ...getSpawnPos('video'),
                              title: '前序视频',
                              params: { prompt: '', duration: '5s', ratio: '16:9' },
                            },
                            dropConnectMenu.nodeId,
                            'prompt',
                            'video_out',
                          ),
                        );
                      }}
                      className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400 group-hover:bg-rose-500/25 transition-colors">
                        <Video size={14} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-medium text-ink group-hover:text-white">Video / 前序视频</span>
                        <span className="text-[10px] text-ink-muted truncate">作为前序镜头继续接戏</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void handleCreateAndSelect(
                          canvasStore.addNodeAndConnectToTarget(
                            sessionId,
                            {
                              type: 'audio',
                              ...getSpawnPos('audio'),
                              title: '配乐音频',
                            },
                            dropConnectMenu.nodeId,
                            'prompt',
                            'audio_out',
                          ),
                        );
                      }}
                      className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 group-hover:bg-amber-500/25 transition-colors">
                        <Volume2 size={14} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-medium text-ink group-hover:text-white">Audio / 配乐</span>
                        <span className="text-[10px] text-ink-muted truncate">提供背景音频轨道</span>
                      </div>
                    </button>
                  </div>
                </>
              );
            }

            return (
              <>
                <div className="flex items-center justify-between px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-muted/70">
                  <span>Generate from this node</span>
                  <span className="text-[10px] text-accent/80 truncate max-w-[80px]">➔ {nodeTitle}</span>
                </div>

                <div className="flex flex-col gap-0.5 mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      void handleCreateAndSelect(
                        canvasStore.addNodeAndConnect(
                          sessionId,
                          {
                            type: 'note',
                            ...getSpawnPos('note'),
                            title: '提示词',
                          },
                          dropConnectMenu.nodeId,
                          dropConnectMenu.handleId,
                          'text_in',
                        ),
                      );
                    }}
                    className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 group-hover:bg-emerald-500/25 transition-colors">
                      <Type size={14} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-medium text-ink group-hover:text-white">Text Generation</span>
                      <span className="text-[10px] text-ink-muted truncate">Script, Ad copy, Brand text</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void handleCreateAndSelect(
                        canvasStore.addNodeAndConnect(
                          sessionId,
                          {
                            type: 'image',
                            ...getSpawnPos('image'),
                            title: '生图',
                          },
                          dropConnectMenu.nodeId,
                          dropConnectMenu.handleId,
                          'prompt',
                        ),
                      );
                    }}
                    className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400 group-hover:bg-indigo-500/25 transition-colors">
                      <ImageIcon size={14} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-medium text-ink group-hover:text-white">Image Generation</span>
                      <span className="text-[10px] text-ink-muted truncate">基于上游画面或提示词生图</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void handleCreateAndSelect(
                        canvasStore.addNodeAndConnect(
                          sessionId,
                          {
                            type: 'video',
                            ...getSpawnPos('video'),
                            title: '视频生成',
                            params: { prompt: '', duration: '5s', ratio: '16:9' },
                          },
                          dropConnectMenu.nodeId,
                          dropConnectMenu.handleId,
                          'prompt',
                        ),
                      );
                    }}
                    className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400 group-hover:bg-rose-500/25 transition-colors">
                      <Video size={14} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-medium text-ink group-hover:text-white">Video Generation</span>
                      <span className="text-[10px] text-ink-muted truncate">首帧动效与运镜生成</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void handleCreateAndSelect(
                        canvasStore.addNodeAndConnect(
                          sessionId,
                          {
                            type: 'audio',
                            ...getSpawnPos('audio'),
                            title: '音频播放',
                          },
                          dropConnectMenu.nodeId,
                          dropConnectMenu.handleId,
                          'prompt',
                        ),
                      );
                    }}
                    className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 group-hover:bg-amber-500/25 transition-colors">
                      <Volume2 size={14} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-medium text-ink group-hover:text-white">Audio</span>
                      <span className="text-[10px] text-ink-muted truncate">配乐与声音生成</span>
                    </div>
                  </button>

                  {anchorNode?.type === 'image' && (
                    <button
                      type="button"
                      onClick={() => {
                        void handleCreateAndSelect(
                          canvasStore.addNodeAndConnect(
                            sessionId,
                            {
                              type: 'image',
                              ...getSpawnPos('image'),
                              title: `${anchorNode.title || '图片'} (变体)`,
                              params: { ...(anchorNode.params as Record<string, unknown>) },
                            },
                            dropConnectMenu.nodeId,
                            dropConnectMenu.handleId,
                            'prompt',
                          ),
                        );
                      }}
                      className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent group-hover:bg-accent/25 transition-colors">
                        <GitBranchPlus size={14} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-medium text-ink group-hover:text-white">派生变体分支</span>
                        <span className="text-[10px] text-ink-muted truncate">快速生成画面变体</span>
                      </div>
                    </button>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      ) : null}

      {addNodesModal ? (
        <AddNodesModal
          x={addNodesModal.x}
          y={addNodesModal.y}
          flowX={addNodesModal.flowX}
          flowY={addNodesModal.flowY}
          onClose={() => setAddNodesModal(null)}
          onSelectType={(type, pos, initialParams) => {
            void canvasStore.addNode(sessionId, type, pos, initialParams as Record<string, unknown>).then((newNodeId) => {
              if (newNodeId) {
                selectNode(newNodeId);
              }
            });
          }}
          onUploadFile={handleUploadFileAt}
          onOpenTimeline={() => setShowStoryboard(true)}
          onOpen3DStudio={() => {
            void canvasStore.addNode(sessionId, 'section', { x: addNodesModal.flowX, y: addNodesModal.flowY }, {
              title: '3D 片场',
              description: '场景多机位与空间编排',
            } as Record<string, unknown>).then((id) => {
              if (id) selectNode(id);
            });
          }}
        />
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
              <span className="text-ink-muted">选区打包为编组</span>
              <kbd className="rounded bg-paper-inset px-1.5 py-0.5 font-mono text-[10px]">Ctrl / ⌘ + G</kbd>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-line/60">
              <span className="text-ink-muted">连线显隐 / 悬停透视</span>
              <kbd className="rounded bg-paper-inset px-1.5 py-0.5 font-mono text-[10px]">Alt + W</kbd>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-line/60">
              <span className="text-ink-muted">快速添加节点</span>
              <span className="text-ink text-[10px]">右键 / 双击空白画布</span>
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

      <input
        ref={paneFileInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const pos = paneUploadTargetPosRef.current ?? { x: 80, y: 80 };
          if (file) {
            void handleUploadFileAt(file, pos);
          }
          e.target.value = '';
        }}
      />
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
