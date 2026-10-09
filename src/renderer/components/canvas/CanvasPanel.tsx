import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  useReactFlow,
  useStore,
  useNodesInitialized,
  applyNodeChanges,
  ConnectionMode,
  SelectionMode,
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
  Undo2,
  Redo2,
  ListRestart,
  LayoutGrid,
  Video,
  HelpCircle,
  Film,
  FileDown,
  FileUp,
  Plus,
  Maximize,
  MoreHorizontal,
  ChevronDown,
  MousePointer2,
  Hand,
  Focus,
  Search,
  ChevronUp,
  X,
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
import { setCanvasInteracting } from '../../lib/canvasInteraction';
import { layoutGraph, wouldCycle, isPortCompatible } from '../../../shared/canvasGraph';
import { estimateGraphCost } from '../../../shared/canvasPricing';
import type { CanvasEdge, CanvasGroupParams, CanvasNode, CanvasNodeType } from '../../../shared/canvas';
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
import CanvasJobsPanel from './CanvasJobsPanel';
import AgentActivityStrip from './AgentActivityStrip';
import LazyStoryboardModal, { preloadStoryboard } from './LazyStoryboardModal';
import LazyPresentationExportModal, { preloadPresentationExport } from './LazyPresentationExportModal';
import CuttableEdge from './edges/CuttableEdge';
import AddNodesModal from './AddNodesModal';
import CanvasContextMenu from './CanvasContextMenu';
import HandleDropMenu, { type HandleDropIntent } from './HandleDropMenu';
import { CanvasToolButton as NavButton, CanvasToolbarDropdown as ToolbarDropdown } from './CanvasToolbar';
import CanvasZoomControls from './CanvasZoomControls';
import { Separator } from '../ui/separator';
import CanvasEmptyPrompt from './CanvasEmptyPrompt';
import ReturnToNodesToast from './ReturnToNodesToast';
import MultiSelectToolbar from './MultiSelectToolbar';
import InsertFromCanvasBanner from './InsertFromCanvasBanner';
import CanvasRefPickBanner from './CanvasRefPickBanner';
import { getCanvasNodeThumbnail } from './canvasThumbnail';
import ErrorBoundary from '../ErrorBoundary';
import { canvasAssetUrlSync } from '../../api';
import { CanvasAutoFocusContext } from './CanvasAutoFocusContext';

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

/** Semantic inputs share one visual intake; persisted handle IDs still drive generation. */
function displayedTargetHandle(nodeType: string | undefined, handle: string | null | undefined) {
  if (nodeType === 'video' && handle && ['start_frame', 'end_frame', 'startFrame', 'endFrame', 'audio_in'].includes(handle)) return 'reference';
  if ((nodeType === 'video' || nodeType === 'image') && handle?.startsWith('ref_')) return 'reference';
  if (nodeType === 'audio' && handle === 'audio_in') return 'prompt';
  if (nodeType === 'note' && (handle === 'prompt' || handle === 'input')) return 'text_in';
  return handle;
}

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

/**
 * Compute layered z-indexes for canvas nodes:
 * 1. Sections: background containers (zIndex = -1).
 * 2. Standalone nodes: base zIndex = 1 (or 20 when actively selected).
 * 3. Group containers: base zIndex = 10 + index * 4 (or 50 when selected).
 *    Because groupZ (10+) > standaloneZ (1), moving a group over outside nodes
 *    causes the group's solid gray background to cleanly occlude the outside nodes.
 * 4. Group members: zIndex = groupZ + 1 (or groupZ + 2 when selected).
 *    Members are always strictly above their group container, so they are never
 *    covered by the group background.
 */
export function computeNodeZIndexes(
  nodes: CanvasNode[],
  isSelectedFn?: (id: string) => boolean,
): Map<string, number> {
  const zIndexMap = new Map<string, number>();

  const groupNodes: CanvasNode[] = [];
  const memberToGroup = new Map<string, { group: CanvasNode; groupIndex: number }>();

  for (const n of nodes) {
    if (n.type === 'group') {
      const idx = groupNodes.length;
      groupNodes.push(n);
      const params = n.params as CanvasGroupParams;
      if (Array.isArray(params?.memberIds)) {
        for (const mId of params.memberIds) {
          memberToGroup.set(mId, { group: n, groupIndex: idx });
        }
      }
    }
  }

  // Pre-calculate group z-indexes
  const groupZMap = new Map<string, number>();
  groupNodes.forEach((g, idx) => {
    const isSelected = isSelectedFn ? isSelectedFn(g.id) : false;
    const groupZ = isSelected ? 15 : 10 + idx * 2;
    groupZMap.set(g.id, groupZ);
    zIndexMap.set(g.id, groupZ);
  });

  // Calculate for all other nodes
  for (const n of nodes) {
    if (n.type === 'section') {
      zIndexMap.set(n.id, -1);
      continue;
    }
    if (n.type === 'group') {
      continue; // already set above
    }

    const isSelected = isSelectedFn ? isSelectedFn(n.id) : false;

    // Any actively selected content node (standalone or group member) is elevated to top layer (1000)
    // so that its Composer / NodeFloatingPanel and controls are NEVER occluded by any other node or group!
    if (isSelected) {
      zIndexMap.set(n.id, 1000);
      continue;
    }

    const groupInfo = memberToGroup.get(n.id);
    if (groupInfo) {
      const baseGroupZ = groupZMap.get(groupInfo.group.id) ?? 10;
      // Member nodes are always strictly above group container (base 20+)
      zIndexMap.set(n.id, baseGroupZ + 10);
    } else {
      zIndexMap.set(n.id, 1);
    }
  }

  return zIndexMap;
}

/**
 * Compute layered z-index for canvas edges:
 * 1. An edge connected to one or more group members (or an elevated node with zIndex >= 20):
 *    Must be rendered strictly ABOVE the group container background plate (groupZ: 10~15),
 *    and just BELOW the member node card (memberZ: 20~25+).
 *    Formula: Math.max(sourceZ, targetZ) - 1.
 *    - Internal group edge (memberZ 20, memberZ 20) -> edgeZ = 19 (19 > groupZ 10, 19 < memberZ 20).
 *    - Inbound edge (outsideZ 1, memberZ 20) -> edgeZ = 19 (19 > groupZ 10, 19 < memberZ 20).
 *    - Outbound edge (memberZ 20, outsideZ 1) -> edgeZ = 19 (19 > groupZ 10, 19 < memberZ 20).
 * 2. An edge between two standalone outside nodes:
 *    - Both endpoints at zIndex 1 -> edgeZ = 0.
 *    - If an outside node is selected (zIndex 30) -> edgeZ = 29.
 */
export function computeEdgeZIndex(
  edge: { sourceId: string; targetId: string },
  nodeZMap: Map<string, number>,
): number {
  const sourceZ = nodeZMap.get(edge.sourceId) ?? 1;
  const targetZ = nodeZMap.get(edge.targetId) ?? 1;
  const maxZ = Math.max(sourceZ, targetZ);
  return maxZ > 1 ? Math.max(0, maxZ - 1) : 0;
}

function CanvasInner({ sessionId }: { sessionId: string }) {
  const autoFocus = useContext(CanvasAutoFocusContext);
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
  // Canvas interaction tool, Figma/tldraw convention:
  //   'select' — left-drag on empty canvas draws a marquee (the default);
  //              pan via Space-drag, middle-mouse-drag, or trackpad scroll.
  //   'pan'    — the hand tool: any left-drag pans; no marquee.
  // Persisted so it survives tab switches / reloads.
  const [mode, setMode] = useState<'select' | 'pan'>(() => {
    try {
      return (localStorage.getItem('reizo:canvas-tool') as 'select' | 'pan') || 'select';
    } catch {
      return 'select';
    }
  });
  const setToolMode = useCallback((next: 'select' | 'pan') => {
    setMode(next);
    try {
      localStorage.setItem('reizo:canvas-tool', next);
    } catch {
      /* ignore */
    }
  }, []);
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
  const [showPresentationExport, setShowPresentationExport] = useState(false);
  const [pendingExportNodeId, setPendingExportNodeId] = useState<string | null>(null);
  const [utilityPanel, setUtilityPanel] = useState<'assets' | 'jobs' | null>(null);
  const [graphRepairEpoch, setGraphRepairEpoch] = useState(0);
  const canvasRootRef = useRef<HTMLDivElement>(null);
  const [emptyCreating, setEmptyCreating] = useState<string | null>(null);
  const [emptyCreationError, setEmptyCreationError] = useState<string | null>(null);
  const emptyCreationPending = useRef(false);
  const preparedEmptyCreations = useRef(new Map<string, () => Promise<string[]>>());
  const preparedSimpleCreations = useRef(new Map<string, () => Promise<void>>());
  const canvasScreenCenter = useCallback(() => {
    const bounds = canvasRootRef.current?.getBoundingClientRect();
    return bounds ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } : { x: 220, y: 160 };
  }, []);
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
  const pickingCanvasRefs = useCanvasStore((s) =>
    sessionId ? s.pickingCanvasRefsBySession[sessionId] : undefined,
  );


  useEffect(() => {
    const handleClear = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId?: string }>).detail;
      if (!detail?.sessionId || detail.sessionId === sessionId) {
        setSelectedNodeIds([]);
        rf.setNodes((nds) => {
          const zIndexes = computeNodeZIndexes(storeNodes, () => false);
          return nds.map((n) => ({
            ...n,
            selected: false,
            zIndex: zIndexes.get(n.id) ?? 1,
          }));
        });
      }
    };
    const handleDeselect = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId?: string; nodeId?: string }>).detail;
      if (detail?.nodeId && (!detail.sessionId || detail.sessionId === sessionId)) {
        const next = canvasStore.getSnapshot().selectedNodeIdsBySession[sessionId] ?? [];
        setSelectedNodeIds(next);
        const nextSet = new Set(next);
        rf.setNodes((nds) => {
            const zIndexes = computeNodeZIndexes(storeNodes, (id) => nextSet.has(id));
            return nds.map((n) => {
              const isSelected = nextSet.has(n.id);
              const nextZ = zIndexes.get(n.id) ?? 1;
              if (n.selected === isSelected && n.zIndex === nextZ) return n;
              return {
                ...n,
                selected: isSelected,
                zIndex: nextZ,
              };
            });
        });
      }
    };
    window.addEventListener('reizo:clear-canvas-selection', handleClear);
    window.addEventListener('reizo:deselect-canvas-node', handleDeselect);
    return () => {
      window.removeEventListener('reizo:clear-canvas-selection', handleClear);
      window.removeEventListener('reizo:deselect-canvas-node', handleDeselect);
    };
  }, [sessionId, rf, storeNodes]);

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
    const moveCamera = autoFocus || spot.source !== 'automatic';
    if (moveCamera && one) {
      // Center AND lift the zoom floor — spotlighting at 30% zoom leaves the
      // node a thumbnail, which defeats the point of focusing it.
      rf.setCenter(one.x + one.w / 2, one.y + one.h / 2, {
        zoom: Math.min(1.25, Math.max(rf.getZoom(), 0.9)),
        duration: reduced ? 0 : 300,
      });
    } else if (moveCamera) {
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
  }, [spot?.at, rf, autoFocus]);

  // When a node's run lands (running -> done), spotlight it so the finished
  // media gets a gentle focus/zoom-in instead of staying a thumbnail.
  const prevRunStatesRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const prev = prevRunStatesRef.current;
    const next = new Map<string, string>();
    const justDone: string[] = [];
    for (const n of storeNodes) {
      next.set(n.id, n.runState ?? 'idle');
      if (prev.get(n.id) === 'running' && n.runState === 'done') justDone.push(n.id);
    }
    prevRunStatesRef.current = next;
    if (justDone.length > 0) canvasStore.spotlight(sessionId, justDone, 'automatic');
  }, [storeNodes, sessionId]);

  const restoredRef = useRef(false);
  const viewportReady = useStore((s) => Boolean(s.panZoom));
  const nodesReady = useNodesInitialized();
  const restoreViewport = useCallback(() => {
    if (restoredRef.current || !viewportReady) return;
    try {
      const raw = localStorage.getItem(VIEWPORT_KEY(sessionId));
      if (raw) {
        const v = JSON.parse(raw) as Viewport;
        if ([v.x, v.y, v.zoom].every(Number.isFinite) && v.zoom > 0) {
          restoredRef.current = true;
          void rf.setViewport({ ...v, zoom: Math.min(3, Math.max(0.05, v.zoom)) });
          return;
        }
      }
    } catch {
      /* ignore */
    }
    // onInit can run before the async snapshot has arrived or nodes are measured.
    if (!loaded || !nodesReady || !storeNodes.length) return;
    restoredRef.current = true;
    void rf.fitView({ padding: 0.2, maxZoom: 1 });
  }, [viewportReady, loaded, nodesReady, storeNodes.length, sessionId, rf]);
  useEffect(() => { restoreViewport(); }, [restoreViewport]);

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
  // Inertia pan: sample viewport positions while panning, glide with decay on release.
  const panSamplesRef = useRef<{ t: number; x: number; y: number; z: number }[]>([]);
  const gestureZoomRef = useRef(1);
  const pointerDownRef = useRef(false);
  const pannedRef = useRef(false);
  const coastingRef = useRef(false);
  // True only while a coast step is inside setViewport. That call reuses the
  // still-active drag gesture, so its move event carries the real mouse
  // event — treating it as a new pan cancels the glide on the first frame.
  const applyingCoastRef = useRef(false);
  const inertiaRafRef = useRef(0);
  const coastTimerRef = useRef(0);
  const [isInteracting, setIsInteracting] = useState(false);
  const [isHeldViewportGesture, setIsHeldViewportGesture] = useState(false);
  // Mirror the drag/pan flag for JS animators (e.g. dither fields) that pause
  // their per-frame painting while a gesture owns the frame budget.
  useEffect(() => {
    setCanvasInteracting(isInteracting);
    return () => setCanvasInteracting(false);
  }, [isInteracting]);

  const stopInertia = useCallback(() => {
    coastingRef.current = false;
    if (inertiaRafRef.current) cancelAnimationFrame(inertiaRafRef.current);
    inertiaRafRef.current = 0;
    if (coastTimerRef.current) {
      window.clearTimeout(coastTimerRef.current);
      coastTimerRef.current = 0;
    }
    setIsHeldViewportGesture(false);
  }, []);

  const settleInteraction = useCallback(() => {
    if (!isDraggingRef.current && !pointerDownRef.current && !isPanningRef.current) {
      setIsHeldViewportGesture(false);
      setIsInteracting(false);
    }
  }, []);

  // Release velocity continues on the same frame the gesture ends. A single
  // d3 setViewport({duration}) waits out React Flow's deferred onMoveEnd
  // (150ms while pan-on-scroll) and then another frame before its first tick,
  // which reads as a freeze before the glide. Zoom is excluded: zooming
  // around the cursor also moves x/y, so a zoom flick would otherwise coast.
  const startCoast = useCallback(() => {
    if (coastingRef.current) return;
    const s = panSamplesRef.current;
    const last = s[s.length - 1];
    if (!last || s.length < 2 || performance.now() - last.t > 100) {
      settleInteraction();
      return;
    }
    if (Math.abs(last.z - gestureZoomRef.current) > 0.002) {
      panSamplesRef.current = [];
      settleInteraction();
      return;
    }
    let i = s.length - 2;
    while (i > 0 && last.t - s[i - 1].t <= 120) i -= 1;
    const base = s[i];
    const dt = Math.max(last.t - base.t, 1);
    let vx = ((last.x - base.x) / dt) * 16.7;
    let vy = ((last.y - base.y) / dt) * 16.7;
    panSamplesRef.current = [];
    if (Math.hypot(vx, vy) < 3) {
      settleInteraction();
      return;
    }
    const zoom = last.z;
    const startedAt = performance.now();
    coastingRef.current = true;
    const finish = () => {
      if (!coastingRef.current) return;
      coastingRef.current = false;
      inertiaRafRef.current = 0;
      // This coast owns the ended gesture. XYFlow's last viewport callback can
      // be programmatic (event=null), so it may not clear the native-pan flag.
      // A new gesture cancels this coast before its finish callback can run.
      isPanningRef.current = false;
      settleInteraction();
      try {
        localStorage.setItem(VIEWPORT_KEY(sessionId), JSON.stringify(rf.getViewport()));
      } catch {
        /* ignore */
      }
    };
    const apply = (decay: boolean): boolean => {
      if (!coastingRef.current) return false;
      if (decay) {
        vx *= 0.92;
        vy *= 0.92;
      }
      if (Math.hypot(vx, vy) < 0.5 || performance.now() - startedAt > 1200) {
        finish();
        return false;
      }
      const vp = rf.getViewport();
      applyingCoastRef.current = true;
      try {
        void rf.setViewport({ x: vp.x + vx, y: vp.y + vy, zoom }, { duration: 0 });
      } finally {
        applyingCoastRef.current = false;
      }
      return true;
    };
    if (!apply(false)) return;
    const step = () => {
      if (!apply(true)) return;
      inertiaRafRef.current = requestAnimationFrame(step);
    };
    inertiaRafRef.current = requestAnimationFrame(step);
  }, [rf, sessionId, settleInteraction]);

  const armCoast = useCallback(() => {
    if (coastTimerRef.current) window.clearTimeout(coastTimerRef.current);
    coastTimerRef.current = window.setTimeout(() => {
      coastTimerRef.current = 0;
      if (pointerDownRef.current) return;
      startCoast();
    }, 32);
  }, [startCoast]);

  useEffect(() => {
    const onDown = () => {
      pointerDownRef.current = true;
      pannedRef.current = false;
      stopInertia();
    };
    const onUp = () => {
      if (!pointerDownRef.current) return;
      pointerDownRef.current = false;
      setIsHeldViewportGesture(false);
      if (pannedRef.current) {
        isPanningRef.current = false;
        startCoast();
      }
      else settleInteraction();
    };
    // pointerdown is capture so the button state is set before the pan samples.
    // pointerup stays bubble so d3-zoom's window mouseup (capture) ends first.
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      stopInertia();
    };
  }, [settleInteraction, startCoast, stopInertia]);
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
    const zIndexes = computeNodeZIndexes(storeNodes);
    return storeNodes.map((node) => {
      const meta = computeNodeInputMeta(node, edgesByTarget, nodesById);
      return {
        id: node.id,
        type: node.type,
        ariaLabel: node.title || node.type,
        position: { x: node.x, y: node.y },
        width: node.w,
        height: node.h,
        zIndex: zIndexes.get(node.id) ?? 1,
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

      const selectedSet = new Set(selectedNodeIds);
      const zIndexes = computeNodeZIndexes(storeNodes, (id) => selectedSet.has(id) || (prevMap.get(id)?.selected ?? false));

      const nextNodes: Node<CanvasNodeData>[] = [];
      for (const node of storeNodes) {
        const prev = prevMap.get(node.id);
        const isHighlighted = highlightIds.includes(node.id);
        const isAgentMark = agentMarkedIds.has(node.id);
        const isProposal = proposals.includes(node.id);
        const isLocked = lockedMembers.has(node.id);
        const zIndex = zIndexes.get(node.id) ?? 1;
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
            ...prev,
            id: node.id,
            type: node.type,
            ariaLabel: node.title || node.type,
            position: { x: node.x, y: node.y },
            width: node.w,
            height: node.h,
            zIndex,
            draggable,
            selected: selectedSet.has(node.id) || prev?.selected === true,
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
  }, [storeNodes, storeEdges, sessionId, highlightIds, lockedMembers, agentMarkedIds, proposals, selectedNodeIds, graphRepairEpoch, rf]);

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

  const edges: Edge[] = useMemo(() => {
    const zIndexes = computeNodeZIndexes(storeNodes, (id) => selectedNodeIds.includes(id));
    const nodeTitles = new Map(storeNodes.map((node) => [node.id, node.title || node.type]));
    return storeEdges.map((edge) => {
      const sourceMeta = nodeMetaMap.get(edge.sourceId);
      const targetMeta = nodeMetaMap.get(edge.targetId);
      const isRunning = Boolean(targetMeta?.isRunning || sourceMeta?.isRunning);
      const isRevealed =
        wiresVisible ||
        hoveredNodeId === edge.sourceId ||
        hoveredNodeId === edge.targetId ||
        selectedNodeIds.includes(edge.sourceId) ||
        selectedNodeIds.includes(edge.targetId);
      const edgeZ = computeEdgeZIndex(edge, zIndexes);
      return {
        id: edge.id,
        type: 'cuttable',
        source: edge.sourceId,
        sourceHandle: edge.sourceHandle,
        target: edge.targetId,
        targetHandle: displayedTargetHandle(targetMeta?.type, edge.targetHandle),
        ariaLabel: `连线：${nodeTitles.get(edge.sourceId) || edge.sourceId} → ${nodeTitles.get(edge.targetId) || edge.targetId}`,
        animated: isRunning,
        zIndex: edgeZ,
        data: {
          sourceType: sourceMeta?.type,
          targetType: targetMeta?.type,
          isRunning,
          isRevealed,
          onCutEdge: handleCutEdge,
          onRerouteEdge: handleRerouteEdge,
        },
      };
    });
  }, [storeEdges, storeNodes, nodeMetaMap, wiresVisible, hoveredNodeId, selectedNodeIds, graphRepairEpoch, handleCutEdge, handleRerouteEdge]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const removed = changes.flatMap((change) => change.type === 'remove' ? [change.id] : []);
      if (removed.length) void canvasStore.removeNodes(sessionId, removed).catch((cause) => {
        setGraphRepairEpoch((epoch) => epoch + 1);
        flash(cause instanceof Error ? cause.message : '删除失败，请稍后重试');
      });
      const liveGeometry = new Map<string, Partial<Pick<CanvasNode, 'x' | 'y' | 'w' | 'h'>>>();
      const resizing = new Set(changes.flatMap((change) => change.type === 'dimensions' && change.resizing ? [change.id] : []));
      for (const change of changes) {
        if (change.type === 'dimensions' && change.resizing && change.dimensions) {
          liveGeometry.set(change.id, { ...liveGeometry.get(change.id), w: change.dimensions.width, h: change.dimensions.height });
        }
        if (change.type === 'position' && change.position &&
          (change.dragging || resizing.has(change.id) || rf.getNode(change.id)?.resizing)) {
          liveGeometry.set(change.id, { ...liveGeometry.get(change.id), x: change.position.x, y: change.position.y });
        }
      }
      canvasStore.moveNodesGeometryLive(sessionId, liveGeometry);
      // Group→members follow is handled in onNodeDrag (rf.getNode is already
      // updated here, so a delta computed from it would always be zero).
    },
    [sessionId, rf, flash],
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
  const [dropConnectMenu, setDropConnectMenu] = useState<HandleDropIntent | null>(null);
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
      setMenu(null);
      setDropConnectMenu(null);
      setOpenTool(null);
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
      setSelectedNodeIds([nodeId]);
      canvasStore.setSelection(sessionId, [nodeId]);
      rf.setNodes((nds) => {
        const selectedSet = new Set([nodeId]);
        const zIndexes = computeNodeZIndexes(storeNodes, (id) => selectedSet.has(id));
        return nds.map((n) => {
          const isSelected = n.id === nodeId;
          const nextZ = zIndexes.get(n.id) ?? (isSelected ? 1000 : 1);
          if (n.selected === isSelected && n.zIndex === nextZ) return n;
          return {
            ...n,
            selected: isSelected,
            zIndex: nextZ,
          };
        });
      });
    },
    [rf, sessionId, storeNodes],
  );

  useEffect(() => {
    if (!pendingExportNodeId || !storeNodes.some((node) => node.id === pendingExportNodeId)) return;
    selectNode(pendingExportNodeId);
    canvasStore.focusNode(sessionId, pendingExportNodeId);
    setPendingExportNodeId(null);
  }, [pendingExportNodeId, storeNodes, selectNode, sessionId]);

  useEffect(() => {
    const openJobs = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; nodeId?: string }>).detail;
      if (detail?.sessionId !== sessionId) return;
      setUtilityPanel('jobs');
      if (detail.nodeId) setPendingExportNodeId(detail.nodeId);
    };
    window.addEventListener('canvas-open-jobs', openJobs);
    return () => window.removeEventListener('canvas-open-jobs', openJobs);
  }, [sessionId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (isPickingReference) return;
      const snap = canvasStore.getSnapshot();
      const pickingId = snap.pickingCanvasRefsBySession[sessionId];
      const el = e.target as HTMLElement | null;
      if (!el?.closest) return;
      if (el.closest('[data-mention-composer], .mention-input, .mention-chip')) return;
      if (el.closest('.react-flow__handle, [data-magnetic-handle]')) return;
      const nodeEl = el.closest('.react-flow__node');
      const id = nodeEl?.getAttribute('data-id');

      if (!pickingId) return;
      if (!id || id === pickingId) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const source = canvasStore.nodeById(sessionId, id);
      if (source) {
        void canvasStore.addComposerRef(sessionId, pickingId, source.id);
        flash(`已加入参考「${source.title || '节点'}」`);
      }
      selectNode(pickingId);
      requestAnimationFrame(() => selectNode(pickingId));
    };
    window.addEventListener('pointerdown', handler, true);
    window.addEventListener('mousedown', handler, true);
    return () => {
      window.removeEventListener('pointerdown', handler, true);
      window.removeEventListener('mousedown', handler, true);
    };
  }, [sessionId, isPickingReference, flash, selectNode]);

  const handleCreateAndSelect = useCallback(
    async (promise: Promise<string | null>) => {
      try {
        const newId = await promise;
        if (newId) requestAnimationFrame(() => selectNode(newId));
      } catch (cause) {
        flash(cause instanceof Error ? cause.message : '创建失败，请稍后重试');
      }
    },
    [selectNode, flash],
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
          const flow = rf.screenToFlowPosition(canvasScreenCenter());
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
    [rf, sessionId, handleUploadFileAt, flash, selectNode, canvasScreenCenter],
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
    const memberIds = selectedNodes.filter((n) => n.type !== 'group').map((n) => n.id);
    if (memberIds.length === 0) return;
    const groupId = await canvasStore.groupNodes(sessionId, memberIds);
    if (groupId) {
      selectNode(groupId);
      flash(`已创建包含 ${memberIds.length} 个节点的编组`);
    }
  }, [sessionId, selectedNodes, selectNode, flash]);

  const isMoodboard = useCanvasStore((s) => s.moodboardBySession[sessionId] ?? false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIdx, setSearchMatchIdx] = useState(-1);

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
    const prevIdx = searchMatchIdx <= 0 ? matchedNodes.length - 1 : (searchMatchIdx - 1) % matchedNodes.length;
    setSearchMatchIdx(prevIdx);
    focusNodeAt(matchedNodes[prevIdx]);
  }, [matchedNodes, searchMatchIdx, focusNodeAt]);

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

      setMenu(null);
      setAddNodesModal(null);
      setOpenTool(null);
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

      setMenu(null);
      setAddNodesModal(null);
      setOpenTool(null);
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
      const pickingId = canvasStore.getSnapshot().pickingCanvasRefsBySession[sessionId];
      let ids = sel.map((n) => n.id);
      if (pickingId) {
        ids = [pickingId];
      }
      setSelectedNodeIds(ids);
      canvasStore.setSelection(sessionId, ids);
      rf.setNodes((prevNodes) => {
        const selectedSet = new Set(ids);
        const zIndexes = computeNodeZIndexes(storeNodes, (id) => selectedSet.has(id));
        return prevNodes.map((n) => {
          const nextZ = zIndexes.get(n.id) ?? (selectedSet.has(n.id) ? 1000 : 1);
          const isSelected = selectedSet.has(n.id);
          if (n.zIndex === nextZ && n.selected === isSelected) return n;
          return { ...n, selected: isSelected, zIndex: nextZ };
        });
      });
    },
    [sessionId, storeNodes, rf],
  );

  const prepareCreationAt = (type: CanvasNodeType, position: { x: number; y: number }, params?: Record<string, unknown>) => {
    const key = JSON.stringify([type, position, params]);
    let run = preparedSimpleCreations.current.get(key);
    if (!run) {
      const commit = canvasStore.prepareNodeCreation(sessionId, { type, ...position, params, ...(typeof params?.title === 'string' ? { title: params.title } : {}) });
      run = async () => {
        const id = await commit();
        preparedSimpleCreations.current.delete(key);
        requestAnimationFrame(() => selectNode(id));
      };
      preparedSimpleCreations.current.set(key, run);
    }
    return run;
  };

  const addNode = (type: CanvasNodeType, at?: { x: number; y: number }) => {
    const center = rf.screenToFlowPosition(canvasScreenCenter());
    try {
      void prepareCreationAt(type, at ?? { x: Math.round(center.x - 160), y: Math.round(center.y - 100) })().catch((cause) => flash(cause instanceof Error ? cause.message : '创建失败'));
    } catch (cause) {
      flash(cause instanceof Error ? cause.message : '创建失败');
    }
  };

  const createEmptyCanvas = async (kind: 'video' | 'image' | 'image-video' | 'audio-video' | 'template') => {
    if (emptyCreationPending.current) return;
    emptyCreationPending.current = true;
    setEmptyCreating('正在创建画布内容…');
    setEmptyCreationError(null);
    try {
      let commit = preparedEmptyCreations.current.get(kind);
      if (!commit) {
        const center = rf.screenToFlowPosition(canvasScreenCenter());
        if (kind === 'image' || kind === 'video') {
          const create = canvasStore.prepareNodeCreation(sessionId, { type: kind, x: Math.round(center.x - 160), y: Math.round(center.y - 100), params: { prompt: '' } });
          commit = async () => [await create()];
        } else if (kind === 'template') {
          const create = canvasStore.prepareStarterFlow(sessionId, { x: Math.round(center.x - 550), y: Math.round(center.y - 260) });
          commit = async () => { await create(); return []; };
        } else {
          const x = Math.round(center.x - 360);
          const y = Math.round(center.y - 120);
          commit = canvasStore.prepareStarterPair(sessionId,
            kind === 'image-video'
              ? { type: 'image', x, y, title: '首帧参考', params: { prompt: '' } }
              : { type: 'audio', x, y, title: '音频参考' },
            { type: 'video', x: x + 400, y, title: '视频生成', params: { prompt: '', duration: '5s', ratio: '16:9' } },
            { sourceHandle: kind === 'image-video' ? 'image_out' : 'audio_out', targetHandle: kind === 'image-video' ? 'start_frame' : 'audio_in' });
        }
        preparedEmptyCreations.current.set(kind, commit);
      }
      const ids = await commit();
      preparedEmptyCreations.current.delete(kind);
      if (ids.length) requestAnimationFrame(() => selectNode(ids[ids.length - 1]));
      if (ids.length !== 1) requestAnimationFrame(() => rf.fitView({ padding: 0.25, duration: 250, maxZoom: 1 }));
      flash(kind === 'template' ? '已载入雨夜影视分镜模板' : '已创建画布内容');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '创建失败，请稍后重试';
      setEmptyCreationError(message);
      flash(message);
    } finally {
      emptyCreationPending.current = false;
      setEmptyCreating(null);
    }
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

  // Canvas commands only run inside this focus boundary. Text editors retain
  // their own undo/paste/select-all; menus and dialogs own their keyboard input.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.defaultPrevented || e.nativeEvent.isComposing || target.closest('[role="dialog"], [role="menu"]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (openTool) setOpenTool(null);
        else if (dropConnectMenu) setDropConnectMenu(null);
        else if (addNodesModal) setAddNodesModal(null);
        else if (searchOpen) { setSearchOpen(false); canvasRootRef.current?.focus({ preventScroll: true }); }
        else if (showShortcuts) setShowShortcuts(false);
        else if (utilityPanel) setUtilityPanel(null);
        else if (canvasStore.getSnapshot().pickingCanvasRefsBySession[sessionId]) canvasStore.stopPickingCanvasRefs(sessionId);
        else if (isPickingReference) chatStore.setPickingReference(sessionId, false);
        else {
          canvasStore.clearMentionComposer(sessionId);
          setSelectedNodeIds([]);
          canvasStore.setSelection(sessionId, []);
          rf.setNodes((nodes) => nodes.map((node) => node.selected ? { ...node, selected: false } : node));
        }
        return;
      }
      const isInput = Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
      if (isInput) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z' && !e.shiftKey) { e.preventDefault(); void canvasStore.undo(sessionId); }
        else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); void canvasStore.redo(sessionId); }
        else if (key === 'c' && selectedNodeIds.length) { e.preventDefault(); handleCopyNodes(selectedNodeIds); }
        else if (key === 'v') { e.preventDefault(); void handlePasteAt(); }
        else if (key === 'a') {
          e.preventDefault();
          const ids = storeNodes.map((node) => node.id);
          setSelectedNodeIds(ids);
          canvasStore.setSelection(sessionId, ids);
          rf.setNodes((nodes) => nodes.map((node) => node.selected ? node : { ...node, selected: true }));
        }
        else if (key === 'g' && !e.shiftKey) { e.preventDefault(); void createGroupFromSelection().catch((cause) => flash(cause instanceof Error ? cause.message : '编组失败')); }
        else if (key === '=' || key === '+') { e.preventDefault(); rf.zoomIn({ duration: 150 }); }
        else if (key === '-' || key === '_') { e.preventDefault(); rf.zoomOut({ duration: 150 }); }
        else if (key === '0') { e.preventDefault(); rf.zoomTo(1, { duration: 150 }); }
        return;
      }
      if (e.altKey) {
        if (key === 'w') { e.preventDefault(); toggleWires(); }
        return;
      }
      if (e.repeat || e.shiftKey) return;
      if (key === 'f') { e.preventDefault(); rf.fitView({ padding: 0.2, duration: 250 }); }
      else if (key === 'm' || key === 'v' && selectedNodeIds.length !== 1) { e.preventDefault(); setToolMode('select'); }
      else if (key === 'z') { e.preventDefault(); zoomToSelection(); }
      else if (key === 'h') {
        e.preventDefault(); canvasStore.toggleMoodboard(sessionId);
        flash(canvasStore.isMoodboard(sessionId) ? '已进入情绪板模式，按 H 退出' : '已退出情绪板模式');
      }
      else if (key === 'r' && selectedNodeIds.length === 1) { e.preventDefault(); void canvasStore.runNode(sessionId, selectedNodeIds[0]); }
      else if (['i', 'v', 't'].includes(key) && selectedNodeIds.length === 1) {
        const source = storeNodes.find((node) => node.id === selectedNodeIds[0]);
        if (!source) return;
        e.preventDefault();
        if (key === 'v' && source.type === 'image') void handleCreateAndSelect(canvasStore.animateFromImage(sessionId, source.id));
        else {
          const type = key === 'i' ? 'image' : key === 'v' ? 'video' : 'note';
          void handleCreateAndSelect(canvasStore.addNodeAndConnect(sessionId,
            { type, x: source.x + source.w + 140, y: source.y, title: type === 'image' ? '图片' : type === 'video' ? '视频生成' : '文本便签', ...(type === 'video' ? { params: { prompt: '', duration: '5s', ratio: '16:9' } } : {}) },
            source.id, null, type === 'note' ? 'text_in' : 'prompt'));
        }
      }
    },
    [sessionId, storeNodes, selectedNodeIds, rf, flash, zoomToSelection, handleCopyNodes, handlePasteAt, setToolMode, openTool, dropConnectMenu, addNodesModal, searchOpen, showShortcuts, utilityPanel, isPickingReference, createGroupFromSelection, toggleWires, handleCreateAndSelect],
  );

  return (
    <div
      ref={canvasRootRef}
      role="region"
      aria-label="创作画布"
      onPointerDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (event.currentTarget.contains(target) && !target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="textbox"], video, audio')) {
          canvasRootRef.current?.focus({ preventScroll: true });
        }
      }}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).classList.contains('react-flow__pane')) openAddNodesModal(event.clientX, event.clientY);
      }}
      data-dragging={isInteracting ? 'true' : undefined}
      data-held-pan={isHeldViewportGesture ? 'true' : undefined}
      data-lowzoom={isLowZoom ? 'true' : undefined}
      className={cn(
        "h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
        isPickingReference && "!cursor-crosshair",
        Boolean(pickingCanvasRefs) && "!cursor-crosshair",
        Boolean(pickingCanvasRefs) && "canvas-mention-pick",
      )}
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
      }}
    >
      <ReactFlow
        defaultNodes={initialNodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        elevateNodesOnSelect={false}
        elevateEdgesOnSelect={true}
        onlyRenderVisibleElements={true}
        connectionMode={ConnectionMode.Loose}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeClick={(_, rfNode) => {
          // Chat composer pick: attach context to the turn. Never wires the graph.
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
        onPaneClick={(e) => {
          const t = e.target as HTMLElement | null;
          if (t?.closest?.('[data-mention-composer], .mention-input')) return;
          if (Date.now() - dropConnectMenuOpenedAt.current < 350) return;
          if (Date.now() - addNodesModalOpenedAt.current < 350) return;
          canvasStore.clearMentionComposer(sessionId);
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
          const allMemberIds = new Set<string>();
          for (const n of dragged) {
            dragStart.current[n.id] = { x: n.position.x, y: n.position.y };
            if (n.type === 'group') {
              for (const memberId of canvasStore.groupMemberIds(sessionId, n.id)) {
                allMemberIds.add(memberId);
                const member = rf.getNode(memberId);
                if (member) {
                  dragStart.current[memberId] = { x: member.position.x, y: member.position.y };
                } else {
                  const storeNode = canvasStore.nodeById(sessionId, memberId);
                  if (storeNode) dragStart.current[memberId] = { x: storeNode.x, y: storeNode.y };
                }
              }
            }
          }
          if (allMemberIds.size > 0) {
            rf.setNodes((nds) =>
              nds.map((item) =>
                allMemberIds.has(item.id)
                  ? { ...item, zIndex: Math.max(item.zIndex ?? 20, 25) }
                  : item,
              ),
            );
          }
        }}
        onNodeDrag={(_, node) => {
          if (node.type !== 'group') return;
          const origin = dragStart.current[node.id];
          if (!origin) return;
          const totalDx = node.position.x - origin.x;
          const totalDy = node.position.y - origin.y;
          const memberIds = new Set(canvasStore.groupMemberIds(sessionId, node.id));
          if (memberIds.size === 0) return;

          // Shift React Flow members synchronously using absolute base offset to eliminate cumulative float drift
          rf.setNodes((nds) =>
            nds.map((n) => {
              if (!memberIds.has(n.id)) return n;
              const mOrigin = dragStart.current[n.id];
              if (!mOrigin) return n;
              return {
                ...n,
                position: { x: mOrigin.x + totalDx, y: mOrigin.y + totalDy },
                zIndex: Math.max(n.zIndex ?? 20, 25),
              };
            }),
          );

          // Synchronize canvas store live positions using the same absolute displacement
          const liveMoves = new Map<string, { x: number; y: number }>();
          liveMoves.set(node.id, { x: node.position.x, y: node.position.y });
          for (const mId of memberIds) {
            const mOrigin = dragStart.current[mId];
            if (mOrigin) {
              liveMoves.set(mId, { x: mOrigin.x + totalDx, y: mOrigin.y + totalDy });
            }
          }
          canvasStore.moveNodesBatchLive(sessionId, liveMoves);
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
          // A member dragged on its own leaves the container box out of sync —
          // snap it back around its members. Dragging the group itself already
          // moves members in lockstep, so its box stays correct.
          const refitted = new Set<string>();
          for (const n of dragged) {
            if (n.type === 'group') continue;
            const g = canvasStore.groupOf(sessionId, n.id);
            if (g && !refitted.has(g.id)) {
              refitted.add(g.id);
              void canvasStore.refitGroup(sessionId, g.id);
            }
          }
        }}
        onInit={restoreViewport}
        onMoveStart={(event, v) => {
          if (!event || applyingCoastRef.current) return;
          stopInertia();
          setIsHeldViewportGesture(pointerDownRef.current && !isDraggingRef.current && !connectingNode.current);
          isPanningRef.current = true;
          setIsInteracting(true);
          panSamplesRef.current = [];
          gestureZoomRef.current = v.zoom;
          pannedRef.current = false;
        }}
        onMove={(event, v) => {
          if (!event || applyingCoastRef.current) return;
          if (coastingRef.current) stopInertia();
          pannedRef.current = true;
          const s = panSamplesRef.current;
          s.push({ t: performance.now(), x: v.x, y: v.y, z: v.zoom });
          if (s.length > 6) s.shift();
          // Wheel / trackpad has no pointerup. Arm a short coast instead of
          // waiting for onMoveEnd, which React Flow defers 150ms when
          // pan-on-scroll is on. Zoom never coasts.
          if (!pointerDownRef.current && Math.abs(v.zoom - gestureZoomRef.current) <= 0.002) {
            armCoast();
          }
        }}
        onMoveEnd={(event, v) => {
          if (applyingCoastRef.current) return;
          try {
            if (restoredRef.current) localStorage.setItem(VIEWPORT_KEY(sessionId), JSON.stringify(v));
          } catch {
            /* ignore */
          }
          if (!event) return;
          isPanningRef.current = false;
          if (coastingRef.current) return;
          startCoast();
        }}
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          setAddNodesModal(null);
          setDropConnectMenu(null);
          setOpenTool(null);
          if (!selectedNodeIds.includes(node.id)) selectNode(node.id);
          setMenu({ kind: 'node', x: e.clientX, y: e.clientY, nodeId: node.id });
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          const pe = e as unknown as MouseEvent;
          const flow = rf.screenToFlowPosition({ x: pe.clientX, y: pe.clientY });
          setAddNodesModal(null);
          setDropConnectMenu(null);
          setOpenTool(null);
          setMenu({ kind: 'pane', x: pe.clientX, y: pe.clientY, flowX: Math.round(flow.x), flowY: Math.round(flow.y) });
        }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode={pickingCanvasRefs ? null : ['Meta', 'Control', 'Shift']}
        panActivationKeyCode="Space"
        panOnDrag={mode === 'pan' ? true : [1]}
        selectionOnDrag={mode === 'select'}
        selectionMode={SelectionMode.Partial}
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
          ariaLabel="画布缩略导航图"
          pannable
          zoomable
          className="!bg-paper-inset"
          nodeColor={MINIMAP_NODE_COLOR}
          nodeStrokeColor="transparent"
          nodeBorderRadius={3}
          maskColor="rgba(0, 0, 0, 0.2)"
        />
        <AssetShelf sessionId={sessionId} selectedTargetIds={selectedNodeIds} flash={flash}
          open={utilityPanel === 'assets'} onOpenChange={(open) => setUtilityPanel((current) => open ? 'assets' : current === 'assets' ? null : current)} hideTrigger position="top-left" initialMode="library" />
        <CanvasJobsPanel sessionId={sessionId} open={utilityPanel === 'jobs'} onClose={() => setUtilityPanel(null)} />
        <AgentActivityStrip sessionId={sessionId} />
        <AlignmentGuides sessionId={sessionId} enabled={snapEnabled} />
        <ReturnToNodesToast sessionId={sessionId} />
        <InsertFromCanvasBanner sessionId={sessionId} />
        <CanvasRefPickBanner sessionId={sessionId} />
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
            const ids = selectedNodes.map((node) => node.id);
            void canvasStore.removeNodes(sessionId, ids)
              .then(() => flash(`已删除 ${ids.length} 个节点`))
              .catch((cause) => {
                setGraphRepairEpoch((epoch) => epoch + 1);
                flash(cause instanceof Error ? cause.message : '删除失败，请稍后重试');
              });
          }}
          draftCount={
            selectedNodes.filter(
              (n) => n.type === 'image' && (n.params as { draft?: boolean }).draft === true,
            ).length
          }
          onRefineDrafts={() => {
            const drafts = selectedNodes.filter(
              (n) => n.type === 'image' && (n.params as { draft?: boolean }).draft === true,
            );
            for (const n of drafts) {
              const params = { ...(n.params as Record<string, unknown>), draft: false };
              void canvasStore
                .updateNodeParams(sessionId, n.id, params)
                .then(() => canvasStore.runNode(sessionId, n.id));
            }
            flash(`已启动精渲 ${drafts.length} 张草稿`);
          }}
        />

        {/* Agent Proposal Diff Review Bar + director phase note */}
        <Panel position="top-center" className="mt-3 pointer-events-none z-30">
          <div className="flex flex-col items-center gap-2">
            <ProposalBar
              sessionId={sessionId}
              onFocusProposals={(ids) => {
                rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.35, duration: 250 });
              }}
            />
            <DirectorPhasePill sessionId={sessionId} />
          </div>
        </Panel>

        {storeNodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center select-none">
            <CanvasEmptyPrompt
              pending={emptyCreating}
              error={emptyCreationError}
              onOpenAddModal={() => {
                const center = canvasScreenCenter();
                openAddNodesModal(center.x, center.y - 120);
              }}
              onCreateTextToVideo={() => { void createEmptyCanvas('video'); }}
              onCreateImageNode={() => { void createEmptyCanvas('image'); }}
              onCreateFirstFrameToVideo={() => { void createEmptyCanvas('image-video'); }}
              onCreateAudioToVideo={() => { void createEmptyCanvas('audio-video'); }}
              onLoadTemplate={() => { void createEmptyCanvas('template'); }}
            />
          </div>
        ) : null}

        {/* Creation and project utilities stay in one quiet command rail. */}
        <Panel position="top-left" className="!m-3">
          <div role="group" aria-label="画布工具" className="flex flex-col items-center gap-1.5 rounded-xl border border-line bg-paper-raised p-1.5 shadow-md">
            <ToolbarDropdown
              open={openTool === 'create'}
              onToggle={() => { setMenu(null); setAddNodesModal(null); setDropConnectMenu(null); setOpenTool((value) => value === 'create' ? null : 'create'); }}
              icon={Plus}
              label="添加节点"
              primary
              items={[
                { icon: ImageIcon, label: '图片', onClick: () => addNode('image') },
                { icon: Video, label: '视频', onClick: () => addNode('video') },
                { icon: Type, label: '文本便签', onClick: () => addNode('note') },
                { icon: Volume2, label: '音频', onClick: () => addNode('audio') },
                { icon: Bot, label: 'Agent', onClick: () => addNode('agent') },
              ]}
            />
            <NavButton title="素材库" side="right" active={utilityPanel === 'assets'} onClick={() => setUtilityPanel((value) => value === 'assets' ? null : 'assets')}><Layers /></NavButton>
            <NavButton title="任务历史" side="right" active={utilityPanel === 'jobs'} onClick={() => setUtilityPanel((value) => value === 'jobs' ? null : 'jobs')}><Clock /></NavButton>
            <NavButton title="搜索画布 (Ctrl+F)" side="right" active={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Search /></NavButton>
            <Separator className="my-0.5" />
            <NavButton title="按依赖整理布局" side="right" disabled={!storeNodes.length} onClick={tidy}><LayoutGrid /></NavButton>
            <NavButton title={snapEnabled ? '智能对齐已开启，点击关闭' : '智能对齐已关闭，点击开启'} side="right" active={snapEnabled} onClick={toggleSnap}><Magnet /></NavButton>
            <Separator className="my-0.5" />
            {graphRun?.running ? (
              <NavButton title={`停止运行 (${graphRun.done}/${graphRun.total})`} side="right" primary onClick={() => { void canvasStore.stopGraph(sessionId); }}><Square /></NavButton>
            ) : (
              <NavButton title={confirmAll ? `再次点击确认：${costEstimate.runnableCount} 个节点，约 ${costEstimate.totalPoints} 算力点` : `运行整图 (${costEstimate.runnableCount} 个待生成节点，约 ${costEstimate.totalPoints} 算力点)`} side="right" primary active={confirmAll} disabled={!hasRunnable} onClick={runAll}><PlayCircle /></NavButton>
            )}
            <ToolbarDropdown
              open={openTool === 'more'}
              onToggle={() => { if (openTool !== 'more') { preloadPresentationExport(); if (storeNodes.some((node) => node.type === 'video')) preloadStoryboard(); } setMenu(null); setAddNodesModal(null); setDropConnectMenu(null); setOpenTool((value) => value === 'more' ? null : 'more'); }}
              icon={MoreHorizontal}
              label="更多画布操作"
              items={[
                ...(storeNodes.some((node) => node.type === 'video') ? [{ icon: Film, label: '串联审片', onClick: () => setShowStoryboard(true) }] : []),
                { icon: FileDown, label: '导出演示稿 .pptx', disabled: !storeNodes.some((node) => ['image', 'anchor', 'frameExtractor'].includes(node.type) && node.output?.assets?.length), onClick: () => setShowPresentationExport(true) },
                {
                  icon: FileDown,
                  label: '导出工程 .zip',
                  disabled: !storeNodes.length,
                  onClick: () => { void canvasStore.exportWorkflow(sessionId).then(() => flash('已导出工程 .reizo.zip')).catch((cause) => flash(cause instanceof Error ? cause.message : '导出失败')); },
                },
                { icon: FileUp, label: '导入工程 .zip', onClick: () => workflowFileRef.current?.click() },
                { icon: HelpCircle, label: '快捷键速查', onClick: () => setShowShortcuts((value) => !value) },
              ]}
            />
          </div>
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
        <Panel position="bottom-center" className="!my-3 !mx-0" style={{ width: 'max-content', maxWidth: 'calc(100% - 24px)' }}>
          <div role="group" aria-label="画布导航与历史" className="flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-xl border border-line bg-paper-raised p-1.5 shadow-md">
            <NavButton
              active={mode === 'select'}
              onClick={() => setToolMode('select')}
              title="选择工具：空白拖拽框选 (M)"
            >
              <MousePointer2 size={14} />
            </NavButton>
            <NavButton
              active={mode === 'pan'}
              onClick={() => setToolMode('pan')}
              title="抓手工具：拖拽平移画布（也可随时按住空格临时平移）"
            >
              <Hand size={14} />
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
            <Separator orientation="vertical" className="mx-1 h-4" />
            <CanvasZoomControls />
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
            <Separator orientation="vertical" className="mx-1 h-4" />
            <NavButton onClick={() => void canvasStore.undo(sessionId)} disabled={!history?.canUndo} title="撤销 (Ctrl+Z)">
              <Undo2 size={14} />
            </NavButton>
            <NavButton onClick={() => void canvasStore.redo(sessionId)} disabled={!history?.canRedo} title="重做 (Ctrl+Shift+Z)">
              <Redo2 size={14} />
            </NavButton>
            {(history?.agentRollback ?? 0) > 0 && (
              <NavButton
                onClick={() => {
                  void canvasStore.rollbackAgentTurn(sessionId).then((n) => {
                    if (n > 0) flash(`已回滚本轮 Agent 改动（${n} 处）`);
                  });
                }}
                title={`回滚本轮 Agent 画布改动（${history?.agentRollback} 处）`}
              >
                <ListRestart size={14} />
              </NavButton>
            )}
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
                  setSearchMatchIdx(-1);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) goToPrevMatch();
                    else goToNextMatch();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setSearchOpen(false);
                    canvasRootRef.current?.focus({ preventScroll: true });
                  }
                }}
                aria-label="搜索节点名称或提示词"
                placeholder="搜索节点名称、提示词…"
                className="h-6 w-52 bg-transparent text-xs text-ink placeholder:text-ink-muted/60 focus:outline-hidden"
              />
              {matchedNodes.length > 0 ? (
                <span className="text-[10px] text-ink-muted px-1 shrink-0">
                  {searchMatchIdx >= 0 ? `${searchMatchIdx + 1} / ${matchedNodes.length}` : `${matchedNodes.length} 个匹配`}
                </span>
              ) : searchQuery.trim() ? (
                <span className="text-[10px] text-danger/80 px-1 shrink-0">无匹配</span>
              ) : null}
              <button
                type="button"
                onClick={goToPrevMatch}
                disabled={matchedNodes.length === 0}
                className="rounded p-1 hover:bg-paper-inset text-ink-muted hover:text-ink disabled:opacity-30"
                aria-label="上一个匹配" title="上一个 (Shift+Enter)"
              >
                <ChevronUp size={12} />
              </button>
              <button
                type="button"
                onClick={goToNextMatch}
                disabled={matchedNodes.length === 0}
                className="rounded p-1 hover:bg-paper-inset text-ink-muted hover:text-ink disabled:opacity-30"
                aria-label="下一个匹配" title="下一个 (Enter)"
              >
                <ChevronDown size={12} />
              </button>
              <button
                type="button"
                onClick={() => { setSearchOpen(false); canvasRootRef.current?.focus({ preventScroll: true }); }}
                className="rounded p-1 hover:bg-paper-inset text-ink-muted hover:text-ink"
                aria-label="关闭搜索" title="关闭 (Esc)"
              >
                <X size={12} />
              </button>
            </div>
          </Panel>
        )}

        {toast ? (
          <Panel position="top-center" className="pointer-events-none mt-3">
            <div role="status" aria-live="polite" className="rounded-lg bg-ink px-3 py-1.5 text-xs text-paper-raised shadow-lg">{toast}</div>
          </Panel>
        ) : null}
      </ReactFlow>

      {menu ? (
        <CanvasContextMenu
          key={`${menu.kind}:${menu.x}:${menu.y}`}
          menu={menu}
          onClose={() => setMenu(null)}
          onUploadClick={() => {
            if (menu.kind === 'pane') {
              paneUploadTargetPosRef.current = { x: menu.flowX, y: menu.flowY };
              paneFileInputRef.current?.click();
            }
          }}
          prepareType={(type, params) => prepareCreationAt(type, { x: menu.kind === 'pane' ? menu.flowX : 0, y: menu.kind === 'pane' ? menu.flowY : 0 }, params)}
          onOpenTimeline={() => setShowStoryboard(true)}
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
        <HandleDropMenu
          key={`${dropConnectMenu.nodeId}:${dropConnectMenu.screenX}:${dropConnectMenu.screenY}`}
          sessionId={sessionId}
          intent={dropConnectMenu}
          anchorNode={storeNodes.find((node) => node.id === dropConnectMenu.nodeId)}
          onClose={() => setDropConnectMenu(null)}
          onCreated={(newId) => {
            requestAnimationFrame(() => selectNode(newId));
            flash('已创建节点并连接');
          }}
        />
      ) : null}

      {addNodesModal ? (
        <AddNodesModal
          key={`${addNodesModal.x}:${addNodesModal.y}`}
          x={addNodesModal.x}
          y={addNodesModal.y}
          flowX={addNodesModal.flowX}
          flowY={addNodesModal.flowY}
          onClose={() => setAddNodesModal(null)}
          prepareType={prepareCreationAt}
          onUploadFile={handleUploadFileAt}
          onOpenTimeline={() => setShowStoryboard(true)}
        />
      ) : null}

      {showShortcuts ? (
        <div
          className="fixed right-6 top-14 z-[170] w-72 rounded-2xl border border-line bg-paper-raised/95 p-3.5 shadow-2xl backdrop-blur-md text-xs select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-ink">画布快捷键</span>
            <button
              type="button"
              aria-label="关闭快捷键指南"
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
              <span className="text-ink-muted">搜索画布节点与提示词</span>
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
              <span className="text-ink-muted">临时抓手平移画布</span>
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
        <LazyStoryboardModal
          sessionId={sessionId}
          onComposeAccepted={() => { setShowStoryboard(false); setUtilityPanel('jobs'); }}
          nodes={selectedNodes.some((n) => n.type === 'video') ? selectedNodes : storeNodes}
          onClose={() => setShowStoryboard(false)}
        />
      ) : null}

      {showPresentationExport ? <LazyPresentationExportModal sessionId={sessionId} selectedNodeIds={selectedNodeIds}
        onClose={() => setShowPresentationExport(false)} onQueued={({ nodeId }) => {
          setShowPresentationExport(false);
          setUtilityPanel('jobs');
          setPendingExportNodeId(nodeId);
        }} /> : null}

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

/** Small progress pill under the ProposalBar while the director is laying out
 * ghost nodes — the text rhythm between "planning" and "awaiting approval". */
function DirectorPhasePill({ sessionId }: { sessionId: string }) {
  const phase = useCanvasStore((s) => s.phaseBySession[sessionId]);
  if (!phase) return null;
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-line/70 bg-paper-raised/90 px-3 py-1 text-[11px] text-ink-muted shadow-lg backdrop-blur">
      <span className="size-1.5 rounded-full bg-accent animate-pulse" />
      {phase.label}
      {phase.step && phase.total ? (
        <span className="text-ink-faint">
          {phase.step}/{phase.total}
        </span>
      ) : null}
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
