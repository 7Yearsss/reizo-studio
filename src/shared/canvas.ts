/**
 * Canvas DTOs. A canvas is session-scoped; nodes carry a spatial position and
 * an inline params blob. Slice C ships two node types: `image` (text -> image,
 * optionally image -> image) and `agent` (a headless sub-agent turn — routed
 * but not executed in slice C).
 */

import type { CameraControl } from './cameraMotion';

export type { CameraControl } from './cameraMotion';

export type CanvasNodeType =
  | 'image'
  | 'agent'
  | 'video'
  | 'note'
  | 'group'
  | 'anchor'
  | 'reroute'
  | 'frameExtractor'
  | 'section'
  | 'subgraph';

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
  /**
   * @deprecated Legacy quick-preset enum. Kept for back-compat, preset chips
   * and old `.reizo.zip` imports; `camera` is authoritative whenever present.
   * A node with only `cameraMotion` is read via `cameraFromPreset(cameraMotion)`.
   */
  cameraMotion?: 'none' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'orbit';
  /** Structured camera motion (each axis −10..10). Falls back to `cameraFromPreset(cameraMotion)`. */
  camera?: CameraControl;
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

/** What a reference anchor pins: the subject, the look, or the composition. */
export type AnchorRole = 'character' | 'style' | 'content';
export type AnchorStrength = 'low' | 'mid' | 'high';

export interface CanvasAnchorParams {
  role: AnchorRole;
  strength: AnchorStrength;
  /** Free note, e.g. 「女主 · 红色风衣」; folded into the prompt prefix. */
  note?: string;
}

export const ANCHOR_ROLES: Array<{ id: AnchorRole; label: string; hint: string }> = [
  { id: 'character', label: '角色', hint: '锁定人物外形 / 服装 / 面部' },
  { id: 'style', label: '风格', hint: '锁定色调 / 笔触 / 材质' },
  { id: 'content', label: '内容', hint: '锁定构图 / 场景元素' },
];

export const ANCHOR_STRENGTHS: Array<{ id: AnchorStrength; label: string }> = [
  { id: 'low', label: '弱' },
  { id: 'mid', label: '中' },
  { id: 'high', label: '强' },
];

export interface CanvasFrameExtractorParams {
  mode?: 'start' | 'end' | 'custom';
  timestampSec?: number;
}

export interface CanvasSectionParams {
  color?: 'slate' | 'amber' | 'blue' | 'emerald' | 'violet' | 'rose';
  description?: string;
  memberIds?: string[];
}

export interface CanvasSubgraphParams {
  collapsed?: boolean;
  innerNodeIds?: string[];
  description?: string;
  innerSnapshot?: {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
  };
}

export type CanvasNodeParams =
  | CanvasImageParams
  | CanvasAgentParams
  | CanvasVideoParams
  | CanvasNoteParams
  | CanvasGroupParams
  | CanvasAnchorParams
  | CanvasFrameExtractorParams
  | CanvasSectionParams
  | CanvasSubgraphParams
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

export interface VideoModelCapabilities {
  startFrame: boolean;
  endFrame: boolean;
  camera: boolean;
  reference: boolean;
}

export interface CanvasVideoModelDef {
  id: string;
  name: string;
  badge?: string;
  capabilities: VideoModelCapabilities;
}

export const CANVAS_VIDEO_MODELS: readonly CanvasVideoModelDef[] = [
  {
    id: 'kling-1.5',
    name: '可灵 Kling 1.5 (运镜流畅)',
    badge: '默认',
    capabilities: { startFrame: true, endFrame: true, camera: true, reference: false },
  },
  {
    id: 'kling-2.0',
    name: '可灵 Kling 2.0 HD (电影感)',
    capabilities: { startFrame: true, endFrame: true, camera: true, reference: true },
  },
  {
    id: 'wan-2.1',
    name: 'WAN 2.1 (大幅动态)',
    capabilities: { startFrame: true, endFrame: false, camera: false, reference: false },
  },
  {
    id: 'luma-ray',
    name: 'Luma Ray (大范围推拉)',
    capabilities: { startFrame: true, endFrame: true, camera: true, reference: false },
  },
] as const;

export function getVideoModelCapabilities(modelId?: string): VideoModelCapabilities {
  const model = CANVAS_VIDEO_MODELS.find((m) => m.id === modelId);
  return model?.capabilities ?? { startFrame: true, endFrame: true, camera: true, reference: false };
}

/** Default node box for a freshly created node of each type. */
export function defaultNodeBox(type: CanvasNodeType): { w: number; h: number } {
  if (type === 'image') return { w: 320, h: 380 };
  if (type === 'video') return { w: 340, h: 420 };
  if (type === 'note') return { w: 280, h: 220 };
  if (type === 'group') return { w: 480, h: 360 };
  if (type === 'anchor') return { w: 200, h: 250 };
  if (type === 'reroute') return { w: 24, h: 24 };
  if (type === 'frameExtractor') return { w: 200, h: 160 };
  if (type === 'section') return { w: 560, h: 420 };
  if (type === 'subgraph') return { w: 260, h: 180 };
  return { w: 320, h: 220 };
}

