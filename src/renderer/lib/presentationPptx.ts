import pptxgen from 'pptxgenjs';
import type { PresentationContent } from '../../shared/presentationContent';
import { normalizePresentation, presentationElements } from '../../shared/presentationContent';
import { absoluteBoxForSelection, childArrayInfo, polygonPointsForElement, polygonClosedForElement } from '../vendor/presenton/model/model';
import type { RawElement, RawUi } from '../vendor/presenton/model/core';
import { rawTextRunsForEditor, rawTextListRunsForEditor, rawFont } from '../vendor/presenton/text/template-v2-text';
import type { TextRun } from '../vendor/presenton/types';

function number(value: unknown, fallback = 0): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function color(value: unknown, fallback = '202020'): string {
  const text = String(value ?? '').replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(text) ? text : /^[0-9a-f]{3}$/i.test(text) ? text.split('').map((c) => c + c).join('') : fallback;
}
function imageData(source: string): string {
  if (!source.startsWith('data:image/')) throw new Error('PPTX 导出需要内嵌图片，请先导入图片文件');
  const comma = source.indexOf(','); if (source.slice(0, comma).includes(';base64')) return source;
  const text = decodeURIComponent(source.slice(comma + 1));
  const base64 = btoa(Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join(''));
  return `${source.slice(0, comma).split(';')[0]};base64,${base64}`;
}
function textRuns(runs: TextRun[], base: Record<string, unknown>): pptxgen.TextProps[] {
  return runs.map((run) => {
    if (run.type === 'latex') throw new Error('当前 PPTX 导出尚不支持公式元素，请保留演示稿后单独导出公式图片');
    const font = { ...base, ...run.font };
    return { text: run.text, options: { fontFace: String(font.family || 'Arial'), fontSize: number(font.size, 28) * .75, color: color(font.color), bold: Boolean(font.bold), italic: Boolean(font.italic), underline: { style: font.underline ? 'sng' as const : 'none' as const } } };
  });
}
/** Uses the same layout resolver as the editor, then writes native Office objects. */
export async function exportPresentationPptx(input: PresentationContent, title: string, resolveImageSize = browserImageSize): Promise<Uint8Array> {
  const content = normalizePresentation(input); const pptx = new pptxgen();
  const dimensions = new Map<string, { width: number; height: number }>();
  for (const slide of content.slides) for (const { element } of presentationElements(slide)) {
    if (element.type !== 'image' || element.source_crop || element.fit === 'fill') continue;
    const data = imageData(String(element.data ?? ''));
    if (!dimensions.has(data)) dimensions.set(data, await resolveImageSize(data));
  }
  pptx.defineLayout({ name: 'REIZO_WIDE', width: 1280 / 96, height: 720 / 96 }); pptx.layout = 'REIZO_WIDE'; pptx.title = title; pptx.author = 'Reizo Studio'; pptx.subject = 'Editable presentation';
  for (const source of content.slides) {
    const page = pptx.addSlide(); page.background = { color: color(source.layout.background, 'FFFFFF') }; if (source.notes) page.addNotes(source.notes);
    const ui = source.layout as RawUi;
    const draw = (element: RawElement, componentIndex: number, path: number[]): void => {
      const box = absoluteBoxForSelection(ui, { kind: 'element', componentIndex, elementPath: path });
      if (!box) throw new Error(`无法解析元素布局：${element.name ?? element.type}`);
      const position = { x: box.x / 96, y: box.y / 96, w: Math.max(1, box.width) / 96, h: Math.max(1, box.height) / 96, rotate: number(element.rotation), objectName: String(element.name ?? element.id ?? element.type) };
      const fill: pptxgen.ShapeFillProps = element.fill?.color ? { color: color(element.fill.color), transparency: (1 - number(element.fill.opacity, 1)) * 100 } : { color: 'FFFFFF', transparency: 100 };
      const line: pptxgen.ShapeLineProps = { color: color(element.stroke?.color, 'FFFFFF'), width: number(element.stroke?.width, 0) * .75, transparency: element.stroke?.color ? (1 - number(element.stroke.opacity, 1)) * 100 : 100 };
      const children = childArrayInfo(element);
      if (children) {
        if (number(element.rotation) !== 0) throw new Error('旋转的组合元素暂不能准确导出，请先取消组合旋转');
        if (element.fill?.color) page.addShape(pptx.ShapeType.rect, { ...position, fill, line });
        children.items.forEach((child, index) => draw(child as RawElement, componentIndex, [...path, index])); return;
      }
      if (element.type === 'text' || element.type === 'text-list') {
        const font = rawFont(element);
        const runs = element.type === 'text' ? rawTextRunsForEditor(element) : rawTextListRunsForEditor(element);
        page.addText(textRuns(runs, font), { ...position, margin: 0, fontFace: font.family ?? 'Arial', fontSize: number(font.size, 28) * .75, color: color(font.color), breakLine: false, valign: element.alignment?.vertical === 'middle' ? 'middle' : element.alignment?.vertical === 'bottom' ? 'bottom' : 'top', align: element.alignment?.horizontal ?? 'left', fill, line, paraSpaceAfter: 0 });
      } else if (element.type === 'image' || element.type === 'icon' || element.type === 'svg') {
        const data = imageData(element.type === 'svg' ? `data:image/svg+xml,${encodeURIComponent(String(element.svg))}` : String(element.data ?? ''));
        let sizing: pptxgen.ImageProps['sizing']; let fullW = position.w, fullH = position.h;
        let sourceCrop = element.source_crop;
        if (!sourceCrop && element.fit !== 'fill') {
          const intrinsic = dimensions.get(data); if (!intrinsic) throw new Error('无法读取图片尺寸');
          const placement = presentationImagePlacement(position.w, position.h, intrinsic.width, intrinsic.height, element.fit, number(element.focus_x, 50), number(element.focus_y, 50), number(element.crop_scale, 1));
          position.x += placement.x; position.y += placement.y; position.w = placement.width; position.h = placement.height;
          fullW = position.w; fullH = position.h; sourceCrop = placement.crop;
        }
        if (sourceCrop) {
          const crop = sourceCrop; const left = number(crop.l) / 100, right = number(crop.r) / 100, top = number(crop.t) / 100, bottom = number(crop.b) / 100;
          if (left + right >= 1 || top + bottom >= 1) throw new Error('图片裁剪区域无效');
          fullW /= 1 - left - right; fullH /= 1 - top - bottom;
          sizing = { type: 'crop', w: position.w, h: position.h, x: fullW * left, y: fullH * top };
        }
        page.addImage({ ...position, w: fullW, h: fullH, data, sizing, rounding: String(element.clippath ?? '').startsWith('ellipse('), flipH: Boolean(element.flip_h), flipV: Boolean(element.flip_v), transparency: (1 - number(element.opacity, 1)) * 100 });
      } else if (element.type === 'vector') {
        const points = polygonPointsForElement(element); const closed = polygonClosedForElement(element);
        if (points.length < 2) throw new Error('矢量元素没有有效路径');
        if (element.shape === 'ellipse') page.addShape(pptx.ShapeType.ellipse, { ...position, fill, line });
        else {
          const minX = Math.min(...points.map((p) => p.x)), minY = Math.min(...points.map((p) => p.y));
          const width = Math.max(1, Math.max(...points.map((p) => p.x)) - minX), height = Math.max(1, Math.max(...points.map((p) => p.y)) - minY);
          const geometry: NonNullable<pptxgen.ShapeProps['points']> = points.map((point) => ({ x: (point.x - minX) / width * position.w, y: (point.y - minY) / height * position.h }));
          if (closed) geometry.push({ close: true });
          // PptxGenJS 4.0.1 implements custGeom but omits it from the enum declaration.
          page.addShape('custGeom' as pptxgen.ShapeType, { ...position, points: geometry, fill: closed ? fill : { color: 'FFFFFF', transparency: 100 }, line });
        }
      } else if (['rectangle', 'ellipse', 'line'].includes(element.type)) {
        page.addShape(element.type === 'ellipse' ? pptx.ShapeType.ellipse : element.type === 'line' ? pptx.ShapeType.line : pptx.ShapeType.rect, { ...position, fill, line });
      } else if (element.type === 'table') {
        const rows = [element.columns ?? [], ...(element.rows ?? [])] as Record<string, unknown>[][];
        if (!rows[0].length) throw new Error('表格缺少列');
        page.addTable(rows.map((row) => row.map((cell) => ({ text: textRuns((cell.runs ?? []) as TextRun[], { ...element.font, ...(cell.font as object ?? {}) }), options: { fill: { color: color((cell.color as { color?: string })?.color, 'FFFFFF') }, margin: 4, align: (cell.alignment ?? 'left') as 'left', border: { type: 'solid', color: 'CCCCCC', pt: 0.75 } } }))), { ...position, autoPage: false, colW: Array(rows[0].length).fill(position.w / rows[0].length), rowH: position.h / rows.length, fontFace: String(element.font?.family ?? 'Arial'), fontSize: number(element.font?.size, 24) * .75, margin: 0 });
      } else if (element.type === 'chart') {
        const chartTypes: Record<string, pptxgen.CHART_NAME> = { bar: pptx.ChartType.bar, horizontal_bar: pptx.ChartType.bar, stacked_bar: pptx.ChartType.bar, horizontal_stacked_bar: pptx.ChartType.bar, line: pptx.ChartType.line, area: pptx.ChartType.area, pie: pptx.ChartType.pie, donut: pptx.ChartType.doughnut, radar: pptx.ChartType.radar };
        const type = chartTypes[element.chart_type]; if (!type) throw new Error(`图表类型 ${element.chart_type} 暂不能准确导出`);
        const categories = (element.categories ?? (element.data ?? []).map((d: { label?: string }) => d.label ?? '')) as string[];
        const series = (element.series ?? [{ name: element.title ?? 'Series', values: (element.data ?? []).map((d: { value?: number }) => d.value ?? 0) }]) as { name: string; values: number[] }[];
        page.addChart(type, series.map((s) => ({ name: s.name, labels: categories, values: s.values })), { ...position, showLegend: Boolean(element.show_legend), showTitle: Boolean(element.title), title: element.title ?? '', showValue: Boolean(element.show_data_labels), catAxisLabelFontSize: 12, valAxisLabelFontSize: 12, barDir: String(element.chart_type).startsWith('horizontal') ? 'bar' : 'col', catAxisLabelPos: 'low', barGrouping: String(element.chart_type).includes('stacked') ? 'stacked' : 'clustered' });
      } else throw new Error(`暂不能准确导出 ${element.type ?? '未知'} 元素，请保留原稿后调整该元素`);
    };
    (source.layout.elements ?? []).forEach((element, index) => draw(element, -1, [index]));
    (source.layout.components ?? []).forEach((component, index) => (component.elements ?? []).forEach((element, elementIndex) => draw(element, index, [elementIndex])));
  }
  return new Uint8Array(await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer);
}

async function browserImageSize(data: string): Promise<{ width: number; height: number }> {
  if (typeof Image === 'undefined') throw new Error('当前环境不能解析图片尺寸');
  return new Promise((resolve, reject) => {
    const image = new Image(); const timer = setTimeout(() => reject(new Error('读取图片尺寸超时')), 10000);
    image.onload = () => { clearTimeout(timer); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('无法解码演示稿图片')); }; image.src = data;
  });
}

/** Same contain/cover/focus geometry as the vendored Presenton image renderer. */
export function presentationImagePlacement(w: number, h: number, naturalW: number, naturalH: number, fit: unknown, focusX = 50, focusY = 50, cropScale = 1) {
  const ratio = naturalW / naturalH; const boxRatio = w / h;
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('图片尺寸无效');
  const fx = Math.max(0, Math.min(1, focusX / 100)), fy = Math.max(0, Math.min(1, focusY / 100));
  const zoom = Math.max(.1, Math.min(6, cropScale));
  let drawW = w, drawH = h, x = 0, y = 0;
  if (fit === 'cover') {
    drawW = ratio > boxRatio ? h * ratio * zoom : w * zoom;
    drawH = ratio > boxRatio ? h * zoom : w / ratio * zoom;
    x = (w - drawW) * fx; y = (h - drawH) * fy;
  } else { if (ratio > boxRatio) { drawH = w / ratio; y = (h - drawH) * fy; } else { drawW = h * ratio; x = (w - drawW) * fx; } }
  const left = Math.max(0, -x) / drawW * 100, top = Math.max(0, -y) / drawH * 100;
  const right = Math.max(0, x + drawW - w) / drawW * 100, bottom = Math.max(0, y + drawH - h) / drawH * 100;
  return { x: Math.max(0, x), y: Math.max(0, y), width: Math.min(w, x + drawW) - Math.max(0, x), height: Math.min(h, y + drawH) - Math.max(0, y), crop: { l: left, t: top, r: right, b: bottom } };
}
