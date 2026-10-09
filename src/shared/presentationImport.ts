import JSZip from 'jszip';
import { parse as parsePptx, type Element as PptxElement, type Chart as PptxChart, type CommonChart, type Table as PptxTable } from 'pptxtojson/dist/index.js';
import { parseDocument, DomUtils } from 'htmlparser2';
import type { AnyNode, Element as HtmlElement } from 'domhandler';
import { normalizePresentation, type PresentationContent, type PresentationElement } from './presentationContent';

export const MAX_PPTX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
type TextRun = { text: string; font: Record<string, unknown> };
function tag(node: AnyNode): node is HtmlElement { return node.type === 'tag' || node.type === 'script' || node.type === 'style'; }
function descendants(node: AnyNode, name: string): HtmlElement[] {
  const children = 'children' in node ? node.children : [];
  return children.flatMap((child) => [...(tag(child) && child.name.split(':').at(-1) === name ? [child] : []), ...descendants(child, name)]);
}
function text(node: AnyNode | undefined): string { return node ? DomUtils.textContent(node) : ''; }
function number(value: unknown, fallback = 0): number { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function hex(value: unknown, fallback = '202020'): string {
  const source = String(value ?? '').replace('#', ''); if (/^[\da-f]{6}$/i.test(source)) return source;
  const rgb = String(value).match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  return rgb ? rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('') : fallback;
}
function markup(content: string, scale: number): { runs: TextRun[]; alignment: string; text: string } {
  const document = parseDocument(content); const runs: TextRun[] = []; let alignment = 'left';
  function visit(node: AnyNode, inherited: Record<string, unknown>) {
    // pptxtojson uses &nbsp; to preserve ordinary spaces in its HTML projection.
    if (node.type === 'text') { if (node.data) runs.push({ text: node.data.replace(/\u00a0/g, ' '), font: { ...inherited } }); return; }
    if (!tag(node) || ['script', 'style'].includes(node.name)) return;
    const styles = Object.fromEntries((node.attribs.style ?? '').split(';').flatMap((part) => { const index = part.indexOf(':'); return index < 0 ? [] : [[part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()]]; }));
    const font = { ...inherited };
    if (styles['font-family']) font.family = styles['font-family'].replace(/["']/g, '').split(',')[0].trim();
    if (styles['font-size']) font.size = parseFloat(styles['font-size']) * scale * (styles['font-size'].endsWith('px') ? .75 : 1);
    if (styles.color) font.color = hex(styles.color);
    if (styles['font-weight']) font.bold = styles['font-weight'] === 'bold' || number(styles['font-weight']) >= 600;
    if (styles['font-style']) font.italic = styles['font-style'] === 'italic';
    if (styles['text-decoration']) font.underline = styles['text-decoration'].includes('underline');
    if (['b', 'strong'].includes(node.name)) font.bold = true;
    if (['i', 'em'].includes(node.name)) font.italic = true;
    if (node.name === 'u') font.underline = true;
    if (styles['text-align']) alignment = styles['text-align'];
    if (node.name === 'br') { runs.push({ text: '\n', font }); return; }
    if (node.name === 'p' && runs.length && !runs.at(-1)?.text.endsWith('\n')) runs.push({ text: '\n', font });
    node.children.forEach((child) => visit(child, font));
  }
  document.children.forEach((node) => visit(node, { family: 'Arial', size: 18 * scale, color: '202020', bold: false, italic: false, underline: false }));
  return { runs, alignment: ['left', 'center', 'right', 'justify'].includes(alignment) ? alignment : 'left', text: runs.map((run) => run.text).join('') };
}
function xmlAttribute(value: unknown): string { return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function chartLabels(zip: JSZip, slideNumber: number): Promise<Map<string, string[]>> {
  const labels = new Map<string, string[]>();
  const source = await zip.file(`ppt/slides/slide${slideNumber}.xml`)?.async('string');
  const relationships = await zip.file(`ppt/slides/_rels/slide${slideNumber}.xml.rels`)?.async('string');
  if (!source || !relationships) return labels;
  const rels = descendants(parseDocument(relationships, { xmlMode: true }), 'Relationship');
  for (const frame of descendants(parseDocument(source, { xmlMode: true }), 'graphicFrame')) {
    const chart = descendants(frame, 'chart')[0]; if (!chart) continue;
    const relation = rels.find((rel) => rel.attribs.Id === chart.attribs['r:id'] && rel.attribs.TargetMode !== 'External');
    if (!relation) continue;
    const target = new URL(relation.attribs.Target, 'https://package.invalid/ppt/slides/').pathname.slice(1);
    if (!target.startsWith('ppt/charts/')) continue;
    const xml = await zip.file(target)?.async('string'); if (!xml) continue;
    const root = parseDocument(xml, { xmlMode: true }); const category = descendants(root, 'cat')[0];
    if (!category) continue;
    const cache = descendants(category, 'strCache')[0] ?? descendants(category, 'strLit')[0] ?? descendants(category, 'numCache')[0] ?? category;
    const entries = descendants(cache, 'pt').sort((a, b) => number(a.attribs.idx) - number(b.attribs.idx));
    const id = descendants(frame, 'cNvPr')[0]?.attribs.id;
    if (id && entries.length) labels.set(id, entries.map((entry) => text(descendants(entry, 'v')[0])));
  }
  return labels;
}

export async function importPresentationPptx(bytes: Uint8Array): Promise<PresentationContent> {
  if (!bytes.byteLength || bytes.byteLength > MAX_PPTX_UPLOAD_BYTES) throw new Error('请选择 8 MB 以内的 PPTX 文件');
  const zip = await JSZip.loadAsync(bytes);
  if (!zip.file('ppt/presentation.xml')) throw new Error('文件不是有效的 PPTX 演示稿');
  const files = Object.values(zip.files); let unpacked = 0;
  for (const file of files) unpacked += number((file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize);
  if (files.length > 10000 || unpacked > 128 * 1024 * 1024) throw new Error('PPTX 解压后内容过大，请拆分演示稿');
  // Copy the exact view: Buffer.buffer may include unrelated bytes before/after it.
  const parsed = await parsePptx(new Uint8Array(bytes).buffer, { imageMode: 'base64', videoMode: 'none', audioMode: 'none' });
  if (!parsed.slides.length || parsed.slides.length > 128) throw new Error('演示稿需要 1 至 128 页');
  const scale = Math.min(1280 / parsed.size.width, 720 / parsed.size.height);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('页面尺寸无效');
  const offset = { x: (1280 - parsed.size.width * scale) / 2, y: (720 - parsed.size.height * scale) / 2 };
  const warnings = new Set<string>(['已转换为可编辑演示稿，原始 PPTX 另行保留。复杂母版、动画、字体和对象效果需要核对。']);
  if (Math.abs(parsed.size.width / parsed.size.height - 16 / 9) > .01) warnings.add('原页面按比例放入 16:9 画布，边缘留白。');
  const slides: PresentationContent['slides'] = [];
  for (let index = 0; index < parsed.slides.length; index++) {
    const source = parsed.slides[index]; const labels = await chartLabels(zip, index + 1);
    let title = `第 ${index + 1} 页`;
    const elements = (items: PptxElement[], origin = offset): PresentationElement[] => {
      return items.flatMap((item): PresentationElement[] => {
        const box = { position: { x: origin.x + item.left * scale, y: origin.y + item.top * scale }, size: { width: Math.max(1, item.width * scale), height: Math.max(1, item.height * scale) } };
        const base = { ...box, id: crypto.randomUUID(), sourceObjectId: item.id, rotation: 'rotate' in item ? item.rotate : 0, flip_h: 'isFlipH' in item && item.isFlipH, flip_v: 'isFlipV' in item && item.isFlipV };
        if (item.type === 'group') {
          // 2.2.0 returns scaled children relative to the group's origin.
          return [{ ...base, type: 'group', name: '导入组合', children: elements(item.elements, { x: 0, y: 0 }) }];
        }
        if (item.type === 'text' || item.type === 'shape') {
          const result: PresentationElement[] = []; const rich = markup(item.content ?? '', scale);
          const fill = item.fill?.type === 'color' ? { color: hex(item.fill.value, 'FFFFFF') } : undefined;
          const stroke = item.borderWidth > 0 ? { color: hex(item.borderColor), width: item.borderWidth * scale } : undefined;
          if (item.fill && item.fill.type !== 'color') warnings.add('渐变、纹理或图片形状填充未完整保留，请对照原稿核对。');
          if (fill || stroke) {
            const shape = item.type === 'shape' ? item.shapType : 'rect';
            if (['rect', 'ellipse', 'line'].includes(shape)) {
              result.push({ ...base, type: shape === 'ellipse' ? 'ellipse' : shape === 'line' ? 'line' : 'rectangle', name: item.name || '形状', fill, stroke });
            } else if (item.type === 'shape' && item.path) {
              const view = item.pathViewBox ?? { x: 0, y: 0, width: item.width, height: item.height };
              const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.size.width}" height="${box.size.height}" viewBox="${view.x} ${view.y} ${view.width} ${view.height}"><path d="${xmlAttribute(item.path)}" fill="${fill ? '#' + fill.color : 'none'}" stroke="${stroke ? '#' + stroke.color : 'none'}" stroke-width="${item.borderWidth}"/></svg>`;
              result.push({ ...base, type: 'svg', name: item.name || '复杂形状', svg }); warnings.add('复杂形状以 SVG 保留，可移动和缩放；形状内部路径不作为普通形状参数编辑。');
            } else warnings.add(`未转换的形状：${item.name || shape}。请查看原始附件。`);
          }
          if (rich.text.trim()) {
            if (title === `第 ${index + 1} 页`) title = rich.text.trim().split('\n')[0].slice(0, 100);
            const inset = item.textInset;
            result.push({ ...base, id: crypto.randomUUID(), type: 'text', name: item.name || '文字', position: { x: box.position.x + number(inset?.l) * scale, y: box.position.y + number(inset?.t) * scale }, size: { width: Math.max(1, box.size.width - (number(inset?.l) + number(inset?.r)) * scale), height: Math.max(1, box.size.height - (number(inset?.t) + number(inset?.b)) * scale) }, runs: rich.runs, font: rich.runs[0]?.font, alignment: { horizontal: rich.alignment, vertical: item.vAlign === 'mid' ? 'middle' : item.vAlign === 'down' ? 'bottom' : 'top' } });
          }
          return result;
        }
        if (item.type === 'image') {
          if (!item.base64) { warnings.add('有图片缺少内嵌内容，请查看原稿。'); return []; }
          if (item.filters) warnings.add('图片滤镜需要对照原稿核对。');
          return [{ ...base, type: 'image', name: '图片', data: item.base64, fit: 'fill', ...(item.rect ? { source_crop: item.rect } : {}), ...(item.geom === 'ellipse' ? { clippath: 'ellipse(50% 50% at 50% 50%)' } : {}) }];
        }
        if (item.type === 'table') return convertTable(item, base, scale, warnings);
        if (item.type === 'chart') return convertChart(item, base, labels.get(item.id), warnings);
        if (item.type === 'math' && item.picBase64) { warnings.add('公式以图片保留，可移动和缩放。'); return [{ ...base, type: 'image', name: '公式', data: item.picBase64, fit: 'contain' }]; }
        warnings.add(`第 ${index + 1} 页的 ${item.type} 对象未转换，请查看原始附件。`); return [];
      });
    };
    const ordered = [...source.layoutElements, ...source.elements];
    const converted = elements(ordered);
    const background = source.fill?.type === 'color' ? hex(source.fill.value, 'FFFFFF') : 'FFFFFF';
    if (source.fill && source.fill.type !== 'color') warnings.add('非纯色页面背景未完整保留，请对照原稿核对。');
    if (source.transition) warnings.add('页面切换效果未转换。');
    slides.push({ id: crypto.randomUUID(), title, notes: markup(source.note ?? '', scale).text, layout: { background, elements: converted } });
  }
  return normalizePresentation({ schemaVersion: 1, slides, importWarnings: [...warnings] });
}

function convertTable(item: PptxTable, base: PresentationElement, scale: number, warnings: Set<string>): PresentationElement[] {
  const complex = item.data.some((row) => row.some((cell) => number(cell.colSpan, 1) > 1 || number(cell.rowSpan, 1) > 1)) || new Set(item.colWidths.map((n) => Math.round(n))).size > 1 || new Set(item.rowHeights.map((n) => Math.round(n))).size > 1;
  if (complex) {
    warnings.add('合并单元格或不等宽表格以可编辑的单元格图形保留；导出后为独立文字与形状。');
    const size = base.size as { width: number; height: number };
    const colCount = Math.max(item.colWidths.length, ...item.data.map((row) => row.length));
    const rawWidths = Array.from({ length: colCount }, (_, i) => item.colWidths[i] || 1);
    const rawHeights = item.data.map((_, i) => item.rowHeights[i] || 1);
    const widths = rawWidths.map((n) => n / rawWidths.reduce((a, b) => a + b, 0) * size.width);
    const heights = rawHeights.map((n) => n / rawHeights.reduce((a, b) => a + b, 0) * size.height);
    const children: PresentationElement[] = [];
    item.data.forEach((row, r) => row.forEach((cell, c) => {
      if (cell.hMerge || cell.vMerge) return;
      const x = widths.slice(0, c).reduce((a, b) => a + b, 0); const y = heights.slice(0, r).reduce((a, b) => a + b, 0);
      const width = widths.slice(c, c + Math.max(1, number(cell.colSpan, 1))).reduce((a, b) => a + b, 0);
      const height = heights.slice(r, r + Math.max(1, number(cell.rowSpan, 1))).reduce((a, b) => a + b, 0);
      children.push({ type: 'rectangle', name: `单元格 ${r + 1}:${c + 1}`, position: { x, y }, size: { width, height }, fill: { color: hex(cell.fillColor, 'FFFFFF') } });
      for (const [edge, border] of Object.entries(cell.borders ?? {})) {
        if (!border || !border.borderWidth) continue;
        const horizontal = edge === 'top' || edge === 'bottom';
        children.push({ type: 'line', name: '单元格边框', position: { x: x + (edge === 'right' ? width : 0), y: y + (edge === 'bottom' ? height : 0) }, size: { width: horizontal ? width : 0, height: horizontal ? 0 : height }, stroke: { color: hex(border.borderColor), width: border.borderWidth * scale } });
      }
      const rich = markup(cell.text, scale);
      if (rich.text) children.push({ type: 'text', name: `单元格文字 ${r + 1}:${c + 1}`, position: { x: x + 4, y: y + 3 }, size: { width: Math.max(1, width - 8), height: Math.max(1, height - 6) }, runs: rich.runs, font: rich.runs[0]?.font, alignment: { horizontal: rich.alignment, vertical: cell.vAlign === 'mid' ? 'middle' : cell.vAlign === 'down' ? 'bottom' : 'top' } });
    }));
    return [{ ...base, type: 'group', name: '导入表格（单元格图形）', children }];
  }
  const rows = item.data.map((row) => row.map((cell) => { const rich = markup(cell.text, scale); return { runs: rich.runs, font: rich.runs[0]?.font, color: { color: hex(cell.fillColor, 'FFFFFF') }, alignment: rich.alignment }; }));
  return [{ ...base, type: 'table', name: '导入表格', columns: rows[0] ?? [], rows: rows.slice(1), font: { family: 'Arial', size: 18 * scale } }];
}
function convertChart(item: PptxChart, base: PresentationElement, labels: string[] | undefined, warnings: Set<string>): PresentationElement[] {
  if (!('chartType' in item) || item.chartType === 'scatterChart' || item.chartType === 'bubbleChart') { warnings.add('散点图或气泡图尚未转换，请查看原始附件。'); return []; }
  const chart = item as CommonChart;
  const types: Record<string, string> = { barChart: 'bar', bar3DChart: 'bar', lineChart: 'line', line3DChart: 'line', areaChart: 'area', area3DChart: 'area', pieChart: 'pie', pie3DChart: 'pie', doughnutChart: 'donut', radarChart: 'radar' };
  let chartType = types[item.chartType]; if (!chartType) { warnings.add(`未转换的图表类型：${item.chartType}`); return []; }
  if (item.chartType.includes('3D')) warnings.add('三维图表已转换为二维图表，保留数据。');
  const series = chart.data.map((s) => ({ name: s.key, values: s.values.map((v) => v.y) }));
  const categories = labels ?? chart.data[0]?.values.map((value) => chart.data[0].xlabels[value.x] ?? value.x) ?? [];
  if (chartType === 'bar' && chart.barDir === 'bar') chartType = 'horizontal_bar';
  if (chartType.endsWith('bar') && chart.grouping === 'stacked') chartType = chartType === 'bar' ? 'stacked_bar' : 'horizontal_stacked_bar';
  return [{ ...base, type: 'chart', name: '导入图表', chart_type: chartType, categories, series, colors: item.colors.map((c) => hex(c)), show_legend: series.length > 1 }];
}
