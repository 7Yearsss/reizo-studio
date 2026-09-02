/**
 * Canvas DTOs. A canvas is session-scoped; nodes carry a spatial position and
 * an inline params blob. Slice C ships two node types: `image` (text -> image,
 * optionally image -> image) and `agent` (a headless sub-agent turn — routed
 * but not executed in slice C).
 */

export type CanvasNodeType = 'image' | 'agent';

export type NodeRunState = 'idle' | 'running' | 'done' | 'error';

export interface CanvasImageParams {
  prompt: string;
  size: '1024x1024' | '1024x1536' | '1536x1024';
  model?: string;
}

export interface CanvasAgentParams {
  instruction: string;
}

export type CanvasNodeParams = CanvasImageParams | CanvasAgentParams | Record<string, unknown>;

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
  /** Result payload. For image nodes: `{ assets: string[], error?: string }`. */
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

/** Default node box for a freshly created node of each type. */
export function defaultNodeBox(type: CanvasNodeType): { w: number; h: number } {
  return type === 'image' ? { w: 320, h: 380 } : { w: 320, h: 220 };
}
