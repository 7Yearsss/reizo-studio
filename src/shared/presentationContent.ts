export const PRESENTATION_MIME = 'application/vnd.reizo.presentation+json';
export const MAX_PRESENTATION_BYTES = 24 * 1024 * 1024;
/** The open editor's Template V2 JSON is preserved, including unfamiliar style fields. */
export interface PresentationElement { id?: string; type?: string; name?: string; elements?: PresentationElement[]; children?: PresentationElement[]; child?: PresentationElement | PresentationElement[]; [key: string]: unknown }
export interface PresentationLayout { components?: PresentationElement[]; elements?: PresentationElement[]; background?: unknown; [key: string]: unknown }
export interface PresentationSlide { id: string; title: string; layout: PresentationLayout; notes?: string }
export interface PresentationContent { schemaVersion: 1; slides: PresentationSlide[]; originalArtifactId?: string; importWarnings?: string[] }
export interface PresentationReference { artifactId: string; name: string; version: number; slideId?: string; elementIds?: string[] }
export type PresentationEdit =
  | { op: 'updateElement'; slideId: string; elementId: string; patch: Record<string, unknown> }
  | { op: 'insertElement'; slideId: string; element: PresentationElement }
  | { op: 'deleteElement'; slideId: string; elementId: string }
  | { op: 'addSlide'; afterId: string | null; slide: PresentationSlide }
  | { op: 'deleteSlide'; slideId: string }
  | { op: 'updateSlide'; slideId: string; title?: string; notes?: string; background?: unknown }
  | { op: 'transformElement'; slideId: string; elementId: string; x?: number; y?: number; width?: number; height?: number }
  | { op: 'arrangeElements'; slideId: string; elementIds: string[]; align: PresentationArrangement; relativeTo?: 'slide' | 'selection' };
export const PRESENTATION_ARRANGEMENTS = ['left', 'center', 'right', 'top', 'middle', 'bottom', 'distribute-horizontal', 'distribute-vertical'] as const;
export type PresentationArrangement = typeof PRESENTATION_ARRANGEMENTS[number];

/** Element IDs an edit touches (an inserted element counts as its own target). */
export function presentationEditTargets(edit: PresentationEdit): string[] {
  if (edit.op === 'updateElement' || edit.op === 'deleteElement' || edit.op === 'transformElement') return [edit.elementId];
  if (edit.op === 'arrangeElements') return edit.elementIds;
  if (edit.op === 'insertElement') return edit.element.id ? [edit.element.id] : [];
  return [];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
/**
 * JSON Merge Patch (RFC 7386): nested objects merge, null removes a key, arrays and scalars replace.
 * An agent changing `font.color` must not wipe `font.size`.
 */
export function mergePresentationPatch(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete target[key];
    else if (isPlainObject(value) && isPlainObject(target[key])) { const merged = { ...(target[key] as Record<string, unknown>) }; mergePresentationPatch(merged, value); target[key] = merged; }
    else target[key] = value;
  }
}

interface Box { x: number; y: number; width: number; height: number }
const SLIDE_BOX: Box = { x: 0, y: 0, width: 1280, height: 720 };
const NO_FRAME = '该元素没有独立的位置（由所在容器排版），请调整它所在的容器';
/** The element's frame on the 1280×720 canvas: position/size, or the bounds of a vector's points. */
export function presentationElementBox(element: PresentationElement): Box | undefined {
  if (element.type === 'vector' && Array.isArray(element.points) && element.points.length) {
    const points = element.points as { x: number; y: number }[];
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  const position = element.position as { x?: unknown; y?: unknown } | undefined; const size = element.size as { width?: unknown; height?: unknown } | undefined;
  const box = { x: position?.x, y: position?.y, width: size?.width, height: size?.height };
  return Object.values(box).every((v) => typeof v === 'number' && Number.isFinite(v)) ? box as Box : undefined;
}
function setElementBox(element: PresentationElement, box: Box) {
  const old = presentationElementBox(element);
  if (!old) throw new Error(NO_FRAME);
  if (element.type === 'vector') {
    const sx = old.width ? box.width / old.width : 1, sy = old.height ? box.height / old.height : 1;
    element.points = (element.points as { x: number; y: number }[]).map((p) => ({ ...p, x: box.x + (p.x - old.x) * sx, y: box.y + (p.y - old.y) * sy }));
  } else {
    element.position = { ...(element.position as object), x: box.x, y: box.y };
    element.size = { ...(element.size as object), width: box.width, height: box.height };
  }
}
function arrange(elements: PresentationElement[], align: PresentationArrangement, relativeTo?: 'slide' | 'selection') {
  const boxes = elements.map((element) => { const box = presentationElementBox(element); if (!box) throw new Error(NO_FRAME); return box; });
  if (align === 'distribute-horizontal' || align === 'distribute-vertical') {
    if (elements.length < 3) throw new Error('均匀分布至少需要 3 个元素');
    const start = align === 'distribute-horizontal' ? 'x' : 'y'; const length = start === 'x' ? 'width' : 'height';
    const order = boxes.map((box, index) => ({ box, index })).sort((a, b) => a.box[start] - b.box[start]);
    const first = order[0].box, last = order[order.length - 1].box;
    const gap = (last[start] + last[length] - first[start] - order.reduce((sum, item) => sum + item.box[length], 0)) / (order.length - 1);
    let cursor = first[start];
    for (const { box, index } of order) { setElementBox(elements[index], { ...box, [start]: cursor }); cursor += box[length] + gap; }
    return;
  }
  // One element aligns to the slide; several align to their shared bounds unless asked otherwise.
  let frame = SLIDE_BOX;
  if (relativeTo === 'selection' || (relativeTo === undefined && elements.length > 1)) {
    const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
    frame = { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
  }
  boxes.forEach((box, index) => {
    const next = { ...box };
    if (align === 'left') next.x = frame.x;
    else if (align === 'center') next.x = frame.x + (frame.width - box.width) / 2;
    else if (align === 'right') next.x = frame.x + frame.width - box.width;
    else if (align === 'top') next.y = frame.y;
    else if (align === 'middle') next.y = frame.y + (frame.height - box.height) / 2;
    else next.y = frame.y + frame.height - box.height;
    setElementBox(elements[index], next);
  });
}

const collectionKeys = ['elements', 'children'] as const;
export function presentationElements(slide: PresentationSlide): { element: PresentationElement; ancestors: string[]; remove(): void }[] {
  const result: { element: PresentationElement; ancestors: string[]; remove(): void }[] = [];
  function visit(items: PresentationElement[] | undefined, ancestors: string[], remove?: () => void) {
    if (!Array.isArray(items)) return;
    for (const element of items) {
      if (!element || typeof element !== 'object' || Array.isArray(element)) throw new Error('页面元素无效');
      result.push({ element, ancestors, remove: remove ?? (() => { items.splice(items.indexOf(element), 1); }) });
      for (const key of collectionKeys) visit(element[key], [...ancestors, element.id ?? '']);
      if (Array.isArray(element.child)) visit(element.child, [...ancestors, element.id ?? '']);
      else if (element.child) visit([element.child], [...ancestors, element.id ?? ''], () => { delete element.child; });
    }
  }
  visit(slide.layout.components, []); visit(slide.layout.elements, []); return result;
}
export function normalizePresentation(value: unknown): PresentationContent {
  const encoded = JSON.stringify(value);
  if (!encoded || new TextEncoder().encode(encoded).byteLength > MAX_PRESENTATION_BYTES) throw new Error('演示稿超过 24 MB 上限');
  const content = JSON.parse(encoded) as PresentationContent;
  if (content?.schemaVersion !== 1 || !Array.isArray(content.slides) || !content.slides.length || content.slides.length > 128) throw new Error('演示稿需要 1 至 128 页');
  if (typeof content.originalArtifactId !== 'string') delete content.originalArtifactId;
  if (Array.isArray(content.importWarnings)) content.importWarnings = content.importWarnings.filter((warning) => typeof warning === 'string').slice(0, 64).map((warning) => warning.slice(0, 1000));
  else delete content.importWarnings;
  const ids = new Set<string>(); let count = 0;
  function id(value: unknown): string {
    const next = typeof value === 'string' && /^[\w-]{1,128}$/.test(value) && !ids.has(value) ? value : crypto.randomUUID(); ids.add(next); return next;
  }
  function check(value: unknown, depth = 0) {
    if (depth > 40) throw new Error('元素嵌套过深');
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e8)) throw new Error('元素数值无效');
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('元素包含不支持的属性');
      check(item, depth + 1);
    }
  }
  check(content);
  for (const slide of content.slides) {
    if (!slide || !slide.layout || typeof slide.layout !== 'object' || Array.isArray(slide.layout)) throw new Error('页面布局无效');
    for (const key of ['components', 'elements']) if (slide.layout[key] !== undefined && !Array.isArray(slide.layout[key])) throw new Error('页面元素集合无效');
    if (slide.layout.background && typeof slide.layout.background === 'object' && 'color' in slide.layout.background) slide.layout.background = String(slide.layout.background.color);
    slide.id = id(slide.id); slide.title = typeof slide.title === 'string' ? slide.title.slice(0, 200) : '幻灯片';
    if (slide.notes !== undefined && typeof slide.notes !== 'string') throw new Error('演讲备注必须是文字');
    const components = new Set(slide.layout.components ?? []);
    for (const { element } of presentationElements(slide)) {
      if (!element || typeof element !== 'object' || Array.isArray(element) || ++count > 6000) throw new Error('演示稿元素无效或超过 6000 个');
      element.id = id(element.id);
      // Presenton's live surface renders vectors/images, not the legacy shape
      // aliases accepted by generation and Office import adapters.
      if (['rectangle', 'ellipse', 'line'].includes(element.type ?? '')) {
        const type = element.type;
        const position = element.position as { x?: number; y?: number } | undefined;
        const size = element.size as { width?: number; height?: number } | undefined;
        const x = position?.x ?? 0, y = position?.y ?? 0, w = size?.width ?? 100, h = size?.height ?? 100;
        if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Error('形状位置与尺寸需要有效数字');
        element.type = 'vector'; element.shape = type === 'ellipse' ? 'ellipse' : 'polygon'; element.closed = type !== 'line';
        element.points = type === 'line' ? [{ x, y }, { x: x + w, y: y + h }] : [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
        delete element.position; delete element.size;
      }
      if (element.type === 'vector' && (element.position || element.size)) {
        const points = element.points as { x: number; y: number }[];
        if (!Array.isArray(points) || points.length < 2) throw new Error('矢量形状需要有效的 points');
        const minX = Math.min(...points.map((p) => p.x)), minY = Math.min(...points.map((p) => p.y));
        const w = Math.max(...points.map((p) => p.x)) - minX, h = Math.max(...points.map((p) => p.y)) - minY;
        const position = element.position as { x: number; y: number } | undefined; const size = element.size as { width: number; height: number } | undefined;
        element.points = points.map((p) => ({ x: (position?.x ?? minX) + (p.x - minX) * (w ? (size?.width ?? w) / w : 1), y: (position?.y ?? minY) + (p.y - minY) * (h ? (size?.height ?? h) / h : 1) }));
        delete element.position; delete element.size;
      }
      if (element.type === 'svg' && typeof element.svg === 'string') { element.type = 'image'; element.data = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(element.svg)}`; element.is_icon = true; delete element.svg; }
      const supported = ['text', 'text-list', 'image', 'vector', 'table', 'chart', 'container', 'flex', 'grid', 'group', 'infographic', 'list-view', 'grid-view'];
      if (!(components.has(element) && element.type === undefined) && !supported.includes(element.type ?? '')) throw new Error(`不支持的演示稿元素类型：${element.type ?? '缺少 type'}`);
      if (element.type === 'vector' && (!Array.isArray(element.points) || element.points.length < 2 || element.points.some((p) => !p || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)))) throw new Error('矢量形状需要有效的 points');
      if (element.type === 'image' && typeof element.data !== 'string') throw new Error('图片元素缺少 data');
      if (element.type === 'text' && element.runs !== undefined && (!Array.isArray(element.runs) || element.runs.some((run) => !run || (typeof run.text !== 'string' && !(run.type === 'latex' && typeof run.latex === 'string'))))) throw new Error('文字元素的 runs 格式无效');
      if (element.type === 'table' && (!Array.isArray(element.columns) || !element.columns.length || !Array.isArray(element.rows) || element.rows.some((row) => !Array.isArray(row) || row.length !== (element.columns as unknown[]).length))) throw new Error('表格需要一致的列和行');
      if ((element.type === 'image' || element.type === 'icon') && typeof element.data === 'string' && !/^(data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]|https?:\/\/)/i.test(element.data)) throw new Error('图片需使用内嵌图片或 HTTP(S) 地址');
    }
  }
  return content;
}
export function parsePresentation(text: string): PresentationContent | null { try { return normalizePresentation(JSON.parse(text)); } catch { return null; } }
export function createPresentation(title = '新演示稿'): PresentationContent {
  return normalizePresentation({ schemaVersion: 1, slides: [{ id: crypto.randomUUID(), title, layout: { background: 'FFFFFF', elements: [
    { type: 'text', name: '标题', position: { x: 100, y: 160 }, size: { width: 1080, height: 120 }, runs: [{ text: title }], font: { family: 'Arial', size: 56, bold: true, color: '202020' }, alignment: { horizontal: 'left', vertical: 'top' } },
    { type: 'text', name: '正文', position: { x: 100, y: 320 }, size: { width: 1040, height: 150 }, runs: [{ text: '双击编辑文字，或引用页面让 AI 提出修改建议。' }], font: { family: 'Arial', size: 28, color: '606060' } },
  ] } }] });
}
export function applyPresentationEdit(content: PresentationContent, edit: PresentationEdit, scope?: PresentationReference): PresentationContent {
  const next = normalizePresentation(content);
  // A scope is tied to the slide/elements still existing, not to the version it was picked on:
  // the user keeps editing (and autosaving) after handing a selection to the chat.
  const scopedSlide = scope?.slideId ? next.slides.find((slide) => slide.id === scope.slideId) : undefined;
  if (scope?.slideId && !scopedSlide) throw new Error('引用的页面已被删除，请重新选择');
  if (scope?.elementIds?.length && scopedSlide && !presentationElements(scopedSlide).some((entry) => scope.elementIds?.includes(entry.element.id ?? ''))) throw new Error('引用的元素已被删除，请重新选择');
  if (scope?.slideId && (edit.op === 'addSlide' || edit.slideId !== scope.slideId)) throw new Error('修改超出引用的页面');
  // Selected elements are the focus, not a cage: adding an element beside them on the same slide is fine.
  if (scope?.elementIds?.length && edit.op !== 'insertElement') {
    if (edit.op === 'addSlide' || edit.op === 'deleteSlide' || edit.op === 'updateSlide') throw new Error('修改超出选中的元素');
    const editSlide = next.slides.find((slide) => slide.id === edit.slideId);
    for (const elementId of presentationEditTargets(edit)) {
      const target = editSlide && presentationElements(editSlide).find((entry) => entry.element.id === elementId);
      if (!scope.elementIds.includes(elementId) && !target?.ancestors.some((id) => scope.elementIds?.includes(id))) throw new Error('修改超出选中的元素');
    }
  }
  if (edit.op === 'addSlide') {
    const index = edit.afterId === null ? -1 : next.slides.findIndex((slide) => slide.id === edit.afterId);
    if (edit.afterId !== null && index < 0) throw new Error('目标页面已变化');
    next.slides.splice(index + 1, 0, edit.slide); return normalizePresentation(next);
  }
  const slide = next.slides.find((slide) => slide.id === edit.slideId);
  if (!slide) throw new Error('目标页面已变化，请重新读取');
  if (edit.op === 'deleteSlide') next.slides = next.slides.filter((s) => s.id !== slide.id);
  else if (edit.op === 'updateSlide') {
    if (edit.title !== undefined) slide.title = edit.title;
    if (edit.notes !== undefined) slide.notes = edit.notes;
    if (edit.background !== undefined) slide.layout.background = edit.background;
  } else if (edit.op === 'insertElement') (slide.layout.elements ??= []).push(edit.element);
  else if (edit.op === 'arrangeElements') {
    const all = presentationElements(slide);
    arrange(edit.elementIds.map((id) => { const found = all.find((entry) => entry.element.id === id); if (!found) throw new Error('目标元素已变化，请重新读取'); return found.element; }), edit.align, edit.relativeTo);
  } else {
    const target = presentationElements(slide).find((entry) => entry.element.id === edit.elementId);
    if (!target) throw new Error('目标元素已变化，请重新读取');
    if (edit.op === 'deleteElement') target.remove();
    else if (edit.op === 'transformElement') {
      const box = presentationElementBox(target.element);
      if (!box) throw new Error(NO_FRAME);
      setElementBox(target.element, { x: edit.x ?? box.x, y: edit.y ?? box.y, width: edit.width ?? box.width, height: edit.height ?? box.height });
    } else {
      if (Object.keys(edit.patch).some((key) => ['id', 'elements', 'children', 'child', '__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('请局部修改目标元素，不要覆盖身份或子元素集合');
      if (target.element.source_crop && ['data', 'fit', 'focus_x', 'focus_y', 'crop_scale'].some((key) => key in edit.patch && target.element[key] !== edit.patch[key])) delete target.element.source_crop;
      const patch = { ...edit.patch };
      if (target.element.type === 'text') {
        if (typeof patch.text === 'string' && !('runs' in patch)) {
          const first = Array.isArray(target.element.runs) ? target.element.runs[0] : undefined;
          patch.runs = [{ text: patch.text, ...(first?.font ? { font: first.font } : {}) }];
        } else if (Array.isArray(patch.runs)) patch.text = patch.runs.map((run) => run.type === 'latex' ? run.latex : run.text ?? '').join('');
      }
      mergePresentationPatch(target.element, patch);
    }
  }
  return normalizePresentation(next);
}
