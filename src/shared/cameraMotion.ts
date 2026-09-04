/**
 * Structured camera motion for video nodes.
 *
 * Each axis is an integer in `[-CAMERA_LIMIT, CAMERA_LIMIT]` (i.e. −10..10),
 * matching Kling's `simple` `camera_control` range and Runway Gen-3's camera
 * intensity sliders. The legacy 6-value `cameraMotion` enum on
 * `CanvasVideoParams` is kept for back-compat and quick presets; `camera` is
 * the source of truth whenever it is present.
 *
 * Pure module — no IO, no DOM, no Node APIs. Shared by the renderer control
 * (`CameraDial`), the video executor, and the drivers.
 */

export interface CameraControl {
  /** Truck / dolly left–right along the horizontal axis. negative = left. */
  horizontal?: number;
  /** Pedestal / boom up–down along the vertical axis. negative = down. */
  vertical?: number;
  /** Pan (yaw) around the vertical axis. negative = pan left. */
  pan?: number;
  /** Tilt (pitch) around the horizontal axis. negative = tilt down. */
  tilt?: number;
  /** Roll around the lens axis. negative = counter-clockwise. */
  roll?: number;
  /** Dolly / zoom along the lens axis. positive = push in. */
  zoom?: number;
}

export type CameraAxis = keyof CameraControl;

/** Max absolute value of any axis. Aligned with Kling `simple` + Runway Gen-3. */
export const CAMERA_LIMIT = 10;

/**
 * Display metadata per axis, in the order the control renders them and the
 * order `cameraToPrompt` / `cameraSummary` phrase them.
 */
export const CAMERA_AXES: Array<{
  id: CameraAxis;
  /** Control label, e.g. `摇移 Pan`. */
  label: string;
  /** Phrase for a negative value, e.g. `向左摇`. */
  negLabel: string;
  /** Phrase for a positive value, e.g. `向右摇`. */
  posLabel: string;
}> = [
  { id: 'pan', label: '摇移 Pan', negLabel: '向左摇', posLabel: '向右摇' },
  { id: 'tilt', label: '俯仰 Tilt', negLabel: '向下俯', posLabel: '向上仰' },
  { id: 'zoom', label: '推拉 Zoom', negLabel: '镜头拉远', posLabel: '镜头推近' },
  { id: 'roll', label: '旋转 Roll', negLabel: '逆时针旋转', posLabel: '顺时针旋转' },
  { id: 'horizontal', label: '平移 Track', negLabel: '向左平移', posLabel: '向右平移' },
  { id: 'vertical', label: '升降 Boom', negLabel: '向下降', posLabel: '向上升' },
];

/** Canonical axis id list (stable iteration order for normalization). */
export const CAMERA_AXIS_IDS: CameraAxis[] = ['horizontal', 'vertical', 'pan', 'tilt', 'roll', 'zoom'];

function clampAxis(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(v);
  if (r > CAMERA_LIMIT) return CAMERA_LIMIT;
  if (r < -CAMERA_LIMIT) return -CAMERA_LIMIT;
  return r;
}

/**
 * The legacy 6-value quick preset → structured value.
 * `'none'` / unknown / nullish → `{}`.
 */
export function cameraFromPreset(preset?: string | null): CameraControl {
  switch (preset) {
    case 'zoom_in':
      return { zoom: 6 };
    case 'zoom_out':
      return { zoom: -6 };
    case 'pan_left':
      return { pan: -6 };
    case 'pan_right':
      return { pan: 6 };
    case 'orbit':
      // No single "orbit" axis on Kling `simple`; approximate with a lateral
      // track + counter-pan and lean on the prompt suffix for the rest.
      return { horizontal: 5, pan: -5 };
    default:
      return {};
  }
}

/**
 * Clamp every axis to `[-10, 10]` and drop zeros. With `singleAxis: true`,
 * keep only the largest-magnitude axis — Kling's `simple` mode accepts exactly
 * one non-zero axis, so the rest must be expressed through the prompt suffix.
 * Ties resolve by `CAMERA_AXIS_IDS` order.
 */
export function normalizeCamera(
  c: CameraControl | null | undefined,
  opts: { singleAxis?: boolean } = {},
): CameraControl {
  const out: CameraControl = {};
  if (!c) return out;
  for (const id of CAMERA_AXIS_IDS) {
    const v = clampAxis(c[id]);
    if (v !== 0) out[id] = v;
  }
  if (opts.singleAxis) {
    let best: CameraAxis | null = null;
    let bestMag = 0;
    for (const id of CAMERA_AXIS_IDS) {
      const mag = Math.abs(out[id] ?? 0);
      if (mag > bestMag) {
        bestMag = mag;
        best = id;
      }
    }
    if (best === null) return {};
    return { [best]: out[best] } as CameraControl;
  }
  return out;
}

/** Whether the control carries any effective motion after normalization. */
export function hasCamera(c: CameraControl | null | undefined): boolean {
  return Object.keys(normalizeCamera(c)).length > 0;
}

function intensityWord(mag: number): string {
  if (mag <= 3) return '缓慢';
  if (mag >= 8) return '大幅';
  return '';
}

/**
 * Structured value → a natural-language Chinese suffix appended to the video
 * prompt (so every driver benefits, even ones with no structured channel).
 * Empty motion → `''`.
 */
export function cameraToPrompt(c: CameraControl | null | undefined): string {
  const n = normalizeCamera(c);
  const parts: string[] = [];
  for (const axis of CAMERA_AXES) {
    const v = n[axis.id];
    if (!v) continue;
    const dir = v < 0 ? axis.negLabel : axis.posLabel;
    parts.push(`${intensityWord(Math.abs(v))}${dir}`);
  }
  return parts.length > 0 ? `镜头运动：${parts.join('、')}。` : '';
}

/**
 * Structured value → a compact one-line UI summary, e.g. `向右摇 6 · 镜头推近 3`.
 * Empty motion → `默认运镜`.
 */
export function cameraSummary(c: CameraControl | null | undefined): string {
  const n = normalizeCamera(c);
  const parts: string[] = [];
  for (const axis of CAMERA_AXES) {
    const v = n[axis.id];
    if (!v) continue;
    const dir = v < 0 ? axis.negLabel : axis.posLabel;
    parts.push(`${dir} ${Math.abs(v)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : '默认运镜';
}

/**
 * Structured value → Kling `camera_control` payload.
 *
 * Kling's `simple` type wants the magnitude under `config`, each field −10..10,
 * with exactly one non-zero — so we single-axis-normalize first and drop the
 * rest (they survive as prompt text via `cameraToPrompt`). Returns `undefined`
 * when there is no motion, so the caller simply omits `camera_control`.
 */
export function cameraToKlingConfig(
  c: CameraControl | null | undefined,
): { type: 'simple'; config: Record<string, number> } | undefined {
  const single = normalizeCamera(c, { singleAxis: true });
  const entries = Object.entries(single) as Array<[CameraAxis, number]>;
  if (entries.length === 0) return undefined;
  const [axis, value] = entries[0];
  // Kling `simple` config keys match our axis ids 1:1
  // (horizontal / vertical / pan / tilt / roll / zoom).
  return { type: 'simple', config: { [axis]: value } };
}
