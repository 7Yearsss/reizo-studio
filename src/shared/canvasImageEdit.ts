import type { CanvasNode } from './canvas';

export type ImageEditKind =
  | 'crop'
  | 'resize'
  | 'annotate'
  | 'split'
  | 'multiAngle'
  | 'inpaint'
  | 'erase'
  | 'relight'
  | 'outpaint'
  | 'enhance'
  | 'matting';

/** 挂在派生 image 节点 params.edit 上的编辑描述符。 */
export interface ImageEditSpec {
  kind: ImageEditKind;
  /** 源图节点 id（用于追溯，执行器优先按 edit_src 边解析，这里冗余存一份）。 */
  sourceNodeId: string;
  /** 已上传到本节点资源目录的蒙版 PNG 的 rel 路径（inpaint/erase/outpaint）。白=作用区。 */
  maskAsset?: string;
  /** 归一化裁剪矩形 0..1（crop；本地已裁，仅留痕）。 */
  cropRect?: { x: number; y: number; w: number; h: number };
  /** 结构化参数，按 kind 取用。 */
  params?: ImageEditParams;
  /** 用户自由文本（inpaint 单区域 / 兼容旧数据）。 */
  instruction?: string;
  /**
   * inpaint 多区域：每个区域一段描述，颜色与彩色蒙版 PNG 中的着色对应。
   * 长度 > 1 时 `buildEditPrompt` 走多区域模板，蒙版按颜色区分；长度 ≤ 1 时
   * 等价于单区域 `instruction`。
   */
  regions?: Array<{ color: string; instruction: string }>;
}

/** 蒙版取色板与中文色名（多区域重绘时写进 prompt）。 */
export const MASK_COLORS = ['#ff2d78', '#22d3ee', '#a3e635', '#f59e0b', '#ffffff'] as const;

export const MASK_COLOR_NAMES: Record<string, string> = {
  '#ff2d78': '品红色',
  '#22d3ee': '青色',
  '#a3e635': '黄绿色',
  '#f59e0b': '橙色',
  '#ffffff': '白色',
};

export function maskColorName(hex: string): string {
  return MASK_COLOR_NAMES[hex.toLowerCase()] ?? hex;
}

export interface ImageEditParams {
  rotateDeg?: number;
  tiltDeg?: number;
  zoom?: number;
  wideAngle?: boolean;
  brightness?: number;
  colorTempK?: number;
  lightDir?: 'left' | 'top' | 'right' | 'front' | 'bottom' | 'back';
  rimLight?: boolean;
  pad?: { left: number; right: number; top: number; bottom: number };
  scale?: 2 | 4;
  strength?: number;
  targetW?: number;
  targetH?: number;
  grid?: '2x2' | '3x3' | '4x4';
}

export const EDIT_META: Record<
  ImageEditKind,
  {
    label: string;
    icon: string;
    local: boolean;
    needsMask: boolean;
    needsCrop: boolean;
    primary: boolean;
  }
> = {
  crop: { label: '裁剪', icon: 'Crop', local: true, needsMask: false, needsCrop: true, primary: true },
  multiAngle: { label: '多角度', icon: 'Box', local: false, needsMask: false, needsCrop: false, primary: true },
  inpaint: { label: '重绘', icon: 'Brush', local: false, needsMask: true, needsCrop: false, primary: true },
  relight: { label: '打光', icon: 'Lightbulb', local: false, needsMask: false, needsCrop: false, primary: true },
  outpaint: { label: '扩图', icon: 'Expand', local: false, needsMask: true, needsCrop: false, primary: false },
  erase: { label: '擦除', icon: 'Eraser', local: false, needsMask: true, needsCrop: false, primary: false },
  annotate: { label: '标注', icon: 'PenLine', local: true, needsMask: false, needsCrop: false, primary: false },
  enhance: { label: '增强', icon: 'Sparkles', local: false, needsMask: false, needsCrop: false, primary: false },
  resize: { label: '调整像素', icon: 'Ruler', local: true, needsMask: false, needsCrop: false, primary: false },
  matting: { label: '抠图', icon: 'Scissors', local: false, needsMask: false, needsCrop: false, primary: false },
  split: { label: '快速切分', icon: 'Grid3x3', local: true, needsMask: false, needsCrop: false, primary: false },
};

export const IMAGE_EDIT_KINDS = Object.keys(EDIT_META) as ImageEditKind[];

export function isLocalEdit(kind: ImageEditKind): boolean {
  return EDIT_META[kind].local;
}

const LIGHT_DIR_LABEL: Record<NonNullable<ImageEditParams['lightDir']>, string> = {
  left: '左侧',
  top: '顶部',
  right: '右侧',
  front: '正前方',
  bottom: '底部',
  back: '背后',
};

/**
 * 结构化参数 → 中文模型指令。纯函数。
 * 约定：模型收到 images = [源图, (可选)蒙版图]，指令里显式说明蒙版语义。
 */
export function buildEditPrompt(spec: ImageEditSpec): string {
  const p = spec.params ?? {};
  const maskNote = spec.maskAsset
    ? '第二张图是蒙版:仅修改蒙版中白色区域,黑色区域必须与原图逐像素一致。'
    : '';
  switch (spec.kind) {
    case 'multiAngle': {
      const bits: string[] = [];
      if (p.rotateDeg) {
        const dir = p.rotateDeg > 0 ? '向右' : '向左';
        bits.push(`相机绕主体${dir}水平环绕约 ${Math.abs(p.rotateDeg)} 度,露出主体${p.rotateDeg > 0 ? '右' : '左'}侧此前看不到的部分`);
      }
      if (p.tiltDeg) {
        bits.push(
          p.tiltDeg > 0
            ? `相机抬高、俯视主体约 ${p.tiltDeg} 度,露出顶面`
            : `相机降低、仰视主体约 ${Math.abs(p.tiltDeg)} 度,露出底面`,
        );
      }
      if (p.zoom) bits.push(p.zoom > 0 ? `镜头推近约 ${p.zoom * 10}%` : `镜头拉远约 ${Math.abs(p.zoom) * 10}%`);
      if (p.wideAngle) bits.push('改用广角镜头,带轻微桶形畸变与更强的透视');
      return `这是一次视角重投影:严格保持主体的外形、比例、材质、颜色与光照风格不变,只改变相机机位,重新渲染为新的观察角度 —— ${bits.join(';') || '轻微换一个角度'}。新暴露的区域按主体结构与场景合理补全,背景保持一致。输出照片级、无接缝。`;
    }
    case 'inpaint': {
      const regions = spec.regions ?? [];
      if (regions.length > 1) {
        const lines = regions.map((r) => {
          const name = maskColorName(r.color);
          const what = r.instruction.trim() || '移除该区域的内容,按周围环境自然填充';
          return `· ${name}区域:${what}`;
        });
        return [
          '第二张图是彩色蒙版,每一种颜色圈出一个需要修改的区域,未着色的部分必须与原图逐像素一致。',
          '按颜色分别处理:',
          ...lines,
          '各区域独立处理、互不影响,边缘与周围自然过渡,无接缝、无色块残留。',
        ].join('\n');
      }
      const only = regions[0]?.instruction?.trim() || spec.instruction?.trim();
      return `${maskNote}在蒙版区域内按以下描述重绘:${only || '与周围环境自然融合的内容'}。边缘平滑过渡,无接缝。`;
    }
    case 'erase':
      return `${maskNote}移除蒙版区域内的物体,用符合周围环境的背景无痕填充,不要留下痕迹或阴影残留。`;
    case 'relight': {
      const dir = LIGHT_DIR_LABEL[p.lightDir ?? 'front'];
      const bits = [`主光来自${dir}`];
      if (typeof p.brightness === 'number') bits.push(`整体亮度约 ${p.brightness}%`);
      if (typeof p.colorTempK === 'number') bits.push(`色温约 ${p.colorTempK}K`);
      if (p.rimLight) bits.push('加入轮廓光勾勒主体边缘');
      return `在不改变主体形状、构图与内容的前提下重新打光:${bits.join('、')}。阴影方向与强度需与新光源一致,保持照片级真实感。`;
    }
    case 'outpaint': {
      const pad = p.pad ?? { left: 0, right: 0, top: 0, bottom: 0 };
      const bits: string[] = [];
      if (pad.left) bits.push(`向左扩展约 ${Math.round(pad.left * 100)}%`);
      if (pad.right) bits.push(`向右扩展约 ${Math.round(pad.right * 100)}%`);
      if (pad.top) bits.push(`向上扩展约 ${Math.round(pad.top * 100)}%`);
      if (pad.bottom) bits.push(`向下扩展约 ${Math.round(pad.bottom * 100)}%`);
      const padNote = bits.length ? `（${bits.join('、')}）` : '';
      return `${maskNote}向画面外扩展构图${padNote},在蒙版(新增边缘)区域内延续原图的场景、透视与风格,自然衔接,不改变原有区域。`;
    }
    case 'enhance':
      return `提升清晰度与细节,放大约 ${p.scale ?? 2} 倍,${(p.strength ?? 50) > 60 ? '较强' : '适度'}锐化与去噪,不改变内容、构图与色调。`;
    case 'matting':
      return `精确抠出主体,移除背景并输出透明背景(alpha 通道)。发丝、边缘保留细节,不带白边。`;
    default:
      return spec.instruction || '按描述编辑图片。';
  }
}

export function editNodeTitle(kind: ImageEditKind): string {
  return EDIT_META[kind].label;
}

/** 就绪检查用：该 edit 节点当前能否运行。 */
export function editReadiness(node: CanvasNode, hasUpstreamImage: boolean): string[] {
  const edit = (node.params as { edit?: ImageEditSpec }).edit;
  if (!edit) return [];
  const issues: string[] = [];
  if (!hasUpstreamImage) issues.push('缺少源图输入');
  if (EDIT_META[edit.kind].needsMask && !edit.maskAsset) issues.push('尚未绘制蒙版');
  if (edit.kind === 'inpaint') {
    const hasRegionText = (edit.regions ?? []).some((r) => r.instruction.trim());
    if (!hasRegionText && !edit.instruction?.trim()) issues.push('重绘描述为空');
  }
  return issues;
}

/** 归一化裁剪框 → 整数像素矩形，至少 1×1。 */
export function pixelCropRect(
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
): { sx: number; sy: number; sw: number; sh: number } {
  const sx = Math.min(Math.max(width - 1, 0), Math.max(0, Math.round(rect.x * width)));
  const sy = Math.min(Math.max(height - 1, 0), Math.max(0, Math.round(rect.y * height)));
  const sw = Math.min(width - sx, Math.max(1, Math.round(rect.w * width)));
  const sh = Math.min(height - sy, Math.max(1, Math.round(rect.h * height)));
  return { sx, sy, sw, sh };
}

export function splitGridSize(grid: '2x2' | '3x3' | '4x4'): number {
  if (grid === '2x2') return 2;
  if (grid === '3x3') return 3;
  return 4;
}

/** 归一化切分矩形，行优先。 */
export function splitGridRects(grid: '2x2' | '3x3' | '4x4'): Array<{ x: number; y: number; w: number; h: number }> {
  const n = splitGridSize(grid);
  const cell = 1 / n;
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      rects.push({ x: col * cell, y: row * cell, w: cell, h: cell });
    }
  }
  return rects;
}
