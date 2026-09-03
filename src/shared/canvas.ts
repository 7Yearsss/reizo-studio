/**
 * Canvas DTOs. A canvas is session-scoped; nodes carry a spatial position and
 * an inline params blob. Slice C ships two node types: `image` (text -> image,
 * optionally image -> image) and `agent` (a headless sub-agent turn — routed
 * but not executed in slice C).
 */

export type CanvasNodeType = 'image' | 'agent' | 'video' | 'note' | 'group';

export type NodeRunState = 'idle' | 'running' | 'done' | 'error';

export interface CanvasImageParams {
  prompt: string;
  size: '1024x1024' | '1024x1536' | '1536x1024';
  model?: string;
}

export interface CanvasAgentParams {
  instruction: string;
}

export interface CanvasVideoParams {
  prompt: string;
  duration?: '5s' | '10s';
  ratio?: '16:9' | '9:16' | '1:1';
  cameraMotion?: 'none' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'orbit';
  provider?: string;
  model?: string;
}

export interface CanvasNoteParams {
  content: string;
  color?: 'amber' | 'slate' | 'rose' | 'emerald' | 'violet';
}

export interface CanvasGroupParams {
  memberIds: string[];
  color?: string;
  locked?: boolean;
}

export type CanvasNodeParams =
  | CanvasImageParams
  | CanvasAgentParams
  | CanvasVideoParams
  | CanvasNoteParams
  | CanvasGroupParams
  | Record<string, unknown>;

export interface CanvasNode {
  id: string;
  canvasId: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  params: CanvasNodeParams;
  /** Stable hash of params + upstream refs, for dirty tracking (seeded, unused in C). */
  paramsHash: string | null;
  runState: NodeRunState;
  /** Result payload. For image/video nodes: `{ assets: string[], error?: string, progress?: number }`. */
  output: CanvasNodeOutput | null;
  updatedAt: string;
  /**
   * Derived (not stored): the node ran before but its params or an upstream
   * output has changed since, so its result is out of date.
   */
  dirty?: boolean;
}

export interface CanvasNodeOutput {
  /** Relative asset paths served by `GET /api/canvas/assets/:canvasId/:file`. */
  assets?: string[];
  text?: string;
  progress?: number;
  error?: string;
}

export interface CanvasEdge {
  id: string;
  canvasId: string;
  sourceId: string;
  sourceHandle: string | null;
  targetId: string;
  targetHandle: string | null;
}

export interface Canvas {
  id: string;
  sessionId: string;
  liveRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasSnapshot {
  canvas: Canvas;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export const CANVAS_IMAGE_SIZES: CanvasImageParams['size'][] = ['1024x1024', '1024x1536', '1536x1024'];
export const CANVAS_VIDEO_RATIOS: NonNullable<CanvasVideoParams['ratio']>[] = ['16:9', '9:16', '1:1'];
export const CANVAS_VIDEO_CAMERAS: Array<{ id: NonNullable<CanvasVideoParams['cameraMotion']>; label: string }> = [
  { id: 'none', label: '默认运镜' },
  { id: 'zoom_in', label: '推进 (Zoom In)' },
  { id: 'zoom_out', label: '拉远 (Zoom Out)' },
  { id: 'pan_left', label: '向左平移 (Pan Left)' },
  { id: 'pan_right', label: '向右平移 (Pan Right)' },
  { id: 'orbit', label: '环绕运镜 (Orbit)' },
];

export const CANVAS_IMAGE_MODELS = [
  { id: 'flux-schnell', name: 'Flux.1 Schnell (极速)', badge: '推荐' },
  { id: 'flux-dev', name: 'Flux.1 Dev (商业写实)' },
  { id: 'sd-3.5', name: 'SD 3.5 Large (平衡)' },
  { id: 'dall-e-3', name: 'DALL-E 3 (奇幻插画)' },
] as const;

export const CANVAS_VIDEO_MODELS = [
  { id: 'kling-1.5', name: '可灵 Kling 1.5 (运镜流畅)', badge: '默认' },
  { id: 'kling-2.0', name: '可灵 Kling 2.0 HD (电影感)' },
  { id: 'wan-2.1', name: 'WAN 2.1 (大幅动态)' },
  { id: 'luma-ray', name: 'Luma Ray (大范围推拉)' },
] as const;

/** Default node box for a freshly created node of each type. */
export function defaultNodeBox(type: CanvasNodeType): { w: number; h: number } {
  if (type === 'image') return { w: 320, h: 380 };
  if (type === 'video') return { w: 340, h: 420 };
  if (type === 'note') return { w: 280, h: 220 };
  if (type === 'group') return { w: 480, h: 360 };
  return { w: 320, h: 220 };
}
