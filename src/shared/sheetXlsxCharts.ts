import JSZip from 'jszip';
import { a1Of, getCell, parseA1, type SheetArtifactContent, type SheetGrid } from './sheetContent';
import { CHART_PALETTE, sheetChartRegion, sheetCharts, type SheetChart } from './sheetChart';

/**
 * Native Excel charts. exceljs cannot write charts, so the finished package is patched with DrawingML
 * chart parts whose series reference the exported cells (with cached values, so they render before
 * Excel recalculates). In Excel they stay editable and follow their data.
 */

const NS = {
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  xdr: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
  rels: 'http://schemas.openxmlformats.org/package/2006/relationships',
  relChart: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
  relDrawing: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing',
  ctChart: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
  ctDrawing: 'application/vnd.openxmlformats-officedocument.drawing+xml',
};
const EMU_PER_PX = 9525;
export const NATIVE_CHART_SIZE = { width: 640, height: 360 };
const LINE_EMU = 2 * EMU_PER_PX;
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
/** Sheet-level elements that must follow <drawing> in CT_Worksheet order. */
const AFTER_DRAWING = ['legacyDrawing', 'legacyDrawingHF', 'drawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst'];

function esc(value: string): string {
  return value.replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch]!);
}
function ref(sheetName: string, r1: number, c1: number, r2: number, c2: number): string {
  const abs = (row: number, col: number) => a1Of(row, col).replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2');
  return `'${sheetName.replaceAll("'", "''")}'!${abs(r1, c1)}${r1 === r2 && c1 === c2 ? '' : `:${abs(r2, c2)}`}`;
}
function text(sheet: SheetGrid, row: number, col: number): string {
  const v = getCell(sheet, row, col)?.v;
  return v === null || v === undefined ? '' : String(v);
}
function num(sheet: SheetGrid, row: number, col: number): number | null {
  const v = getCell(sheet, row, col)?.v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function strCache(values: string[]): string {
  return `<c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
}
function numCache(values: Array<number | null>): string {
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => v === null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache>`;
}
function fill(color: string): string {
  return `<a:solidFill><a:srgbClr val="${color.replace('#', '')}"/></a:solidFill>`;
}

interface ChartPart { chart: SheetChart; xml: string }

function chartXml(content: SheetArtifactContent, chart: SheetChart, sheetNames: Map<string, string>): string {
  const region = sheetChartRegion(content, chart);
  const sheet = content.sheets.find((s) => s.id === region.sheetId);
  const sheetName = sheetNames.get(region.sheetId);
  if (!sheet || !sheetName) throw new Error('图表数据所在的工作表不存在');
  const firstRow = region.r1 + 1;
  if (region.r2 < firstRow) throw new Error('图表没有数据行');
  const rows = Array.from({ length: region.r2 - firstRow + 1 }, (_, i) => firstRow + i);
  const labelCols = Array.from({ length: region.labelCols }, (_, i) => region.c1 + i);
  const valueCols = Array.from({ length: region.c2 - region.c1 - region.labelCols + 1 }, (_, i) => region.c1 + region.labelCols + i);
  if (!valueCols.length) throw new Error('图表数据区域没有数值列');
  const palette = CHART_PALETTE.light;

  const categories = labelCols.length === 1
    ? `<c:cat><c:strRef><c:f>${esc(ref(sheetName, firstRow, labelCols[0]!, region.r2, labelCols[0]!))}</c:f>${strCache(rows.map((r) => text(sheet, r, labelCols[0]!)))}</c:strRef></c:cat>`
    // Nested row fields: levels are listed innermost first.
    : `<c:cat><c:multiLvlStrRef><c:f>${esc(ref(sheetName, firstRow, labelCols[0]!, region.r2, labelCols.at(-1)!))}</c:f><c:multiLvlStrCache><c:ptCount val="${rows.length}"/>${[...labelCols].reverse().map((col) => `<c:lvl>${rows.map((r, i) => `<c:pt idx="${i}"><c:v>${esc(text(sheet, r, col))}</c:v></c:pt>`).join('')}</c:lvl>`).join('')}</c:multiLvlStrCache></c:multiLvlStrRef></c:cat>`;

  const pie = chart.type === 'pie';
  const line = chart.type === 'line';
  const series = (pie ? valueCols.slice(0, 1) : valueCols).map((col, i) => {
    const color = palette[i];
    const style = pie ? '' : line
      ? `<c:spPr><a:ln w="${LINE_EMU}" cap="rnd">${color ? fill(color) : ''}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/>${color ? `<c:spPr>${fill(color)}<a:ln><a:noFill/></a:ln></c:spPr>` : ''}</c:marker>`
      : color ? `<c:spPr>${fill(color)}<a:ln><a:noFill/></a:ln></c:spPr><c:invertIfNegative val="0"/>` : '<c:invertIfNegative val="0"/>';
    const points = pie ? rows.map((_, j) => palette[j] ? `<c:dPt><c:idx val="${j}"/><c:bubble3D val="0"/><c:spPr>${fill(palette[j]!)}<a:ln w="${LINE_EMU}"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>` : '').join('') : '';
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${esc(ref(sheetName, region.r1, col, region.r1, col))}</c:f>${strCache([text(sheet, region.r1, col)])}</c:strRef></c:tx>${style}${points}${categories}<c:val><c:numRef><c:f>${esc(ref(sheetName, firstRow, col, region.r2, col))}</c:f>${numCache(rows.map((r) => num(sheet, r, col)))}</c:numRef></c:val>${line ? '<c:smooth val="0"/>' : ''}</c:ser>`;
  }).join('');

  const axisText = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="55554F"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr>';
  const gridline = '<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E7E7E3"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>';
  const horizontal = chart.type === 'bar';
  const axes = pie ? '' : `<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="D0D0CB"/></a:solidFill></a:ln></c:spPr>${axisText}<c:crossAx val="20"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
    + `<c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 'b' : 'l'}"/>${gridline}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${axisText}<c:crossAx val="10"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  const axIds = pie ? '' : '<c:axId val="10"/><c:axId val="20"/>';
  const plot = pie
    ? `<c:pieChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/></c:pieChart>`
    : line
      ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/>${axIds}</c:lineChart>`
      : `<c:barChart><c:barDir val="${horizontal ? 'bar' : 'col'}"/><c:grouping val="${chart.type === 'stackedColumn' ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>${series}<c:gapWidth val="80"/>${chart.type === 'stackedColumn' ? '<c:overlap val="100"/>' : ''}${axIds}</c:barChart>`;
  const legend = pie || valueCols.length > 1 ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${axisText}</c:legend>` : '';
  const title = `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="zh-CN" sz="1200" b="1"><a:solidFill><a:srgbClr val="3A3A36"/></a:solidFill></a:rPr><a:t>${esc(chart.name)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
  return `${XML_HEAD}<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:roundedCorners val="0"/><c:chart>${title}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr>${fill('#FFFFFF')}<a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`;
}

function anchorXml(chart: SheetChart, id: number, relId: string): string {
  const at = parseA1(chart.anchor.cell) ?? { row: 0, col: 0 };
  return `<xdr:oneCellAnchor><xdr:from><xdr:col>${at.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${at.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${NATIVE_CHART_SIZE.width * EMU_PER_PX}" cy="${NATIVE_CHART_SIZE.height * EMU_PER_PX}"/>`
    + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${esc(chart.name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>`
    + `<a:graphic><a:graphicData uri="${NS.c}"><c:chart xmlns:c="${NS.c}" r:id="${relId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>`;
}

function nextRelId(rels: string): string {
  let n = 1;
  for (const match of rels.matchAll(/Id="rId(\d+)"/g)) n = Math.max(n, Number(match[1]) + 1);
  return `rId${n}`;
}
function addRelationship(rels: string | null, type: string, target: string): { xml: string; id: string } {
  const base = rels ?? `${XML_HEAD}<Relationships xmlns="${NS.rels}"></Relationships>`;
  const id = nextRelId(base);
  return { id, xml: base.replace('</Relationships>', `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`) };
}
function nextPartIndex(zip: JSZip, folder: string, prefix: string): number {
  let n = 1;
  while (zip.file(`${folder}/${prefix}${n}.xml`)) n += 1;
  return n;
}

/** Sheet XML paths in workbook order, resolved through workbook.xml and its relationships. */
async function sheetPaths(zip: JSZip): Promise<string[]> {
  const workbook = await zip.file('xl/workbook.xml')!.async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  return [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const target = targets.get(/r:id="([^"]+)"/.exec(m[0])?.[1]) ?? '';
    return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  });
}

/**
 * Adds every resolvable chart in `content` to an exported workbook. `sheetNames` maps sheet ids to the
 * worksheet names actually written (they may be sanitized). Charts whose data no longer resolves are skipped.
 */
export async function addNativeCharts(bytes: Uint8Array, content: SheetArtifactContent, sheetNames: Map<string, string>): Promise<{ bytes: Uint8Array; skipped: string[] }> {
  const charts = sheetCharts(content);
  if (!charts.length) return { bytes, skipped: [] };
  const parts: ChartPart[] = [];
  const skipped: string[] = [];
  for (const chart of charts) {
    if (!sheetNames.has(chart.anchor.sheetId)) { skipped.push(chart.name); continue; }
    try { parts.push({ chart, xml: chartXml(content, chart, sheetNames) }); } catch { skipped.push(chart.name); }
  }
  if (!parts.length) return { bytes, skipped };

  const zip = await JSZip.loadAsync(bytes);
  const paths = await sheetPaths(zip);
  let types = await zip.file('[Content_Types].xml')!.async('string');
  const override = (part: string, type: string) => { if (!types.includes(`PartName="${part}"`)) types = types.replace('</Types>', `<Override PartName="${part}" ContentType="${type}"/></Types>`); };

  for (const [index, grid] of content.sheets.entries()) {
    const own = parts.filter((p) => p.chart.anchor.sheetId === grid.id);
    const sheetPath = paths[index];
    if (!own.length || !sheetPath || !zip.file(sheetPath)) continue;
    const sheetDir = sheetPath.slice(0, sheetPath.lastIndexOf('/'));
    const sheetFile = sheetPath.slice(sheetPath.lastIndexOf('/') + 1);
    const sheetRelsPath = `${sheetDir}/_rels/${sheetFile}.rels`;
    let sheetXml = await zip.file(sheetPath)!.async('string');
    let sheetRels = await zip.file(sheetRelsPath)?.async('string') ?? null;

    // Reuse the sheet's drawing part when exceljs already wrote one (e.g. images); otherwise create one.
    const existing = /<drawing\b[^>]*r:id="([^"]+)"/.exec(sheetXml)?.[1];
    let drawingPath: string;
    let drawingXml: string;
    if (existing && sheetRels) {
      const target = new RegExp(`<Relationship\\b[^>]*Id="${existing}"[^>]*Target="([^"]+)"`).exec(sheetRels)?.[1] ?? '';
      drawingPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\.\//, '')}`;
      drawingXml = await zip.file(drawingPath)?.async('string') ?? '';
      if (!drawingXml.includes('</xdr:wsDr>')) continue;
    } else {
      drawingPath = `xl/drawings/drawing${nextPartIndex(zip, 'xl/drawings', 'drawing')}.xml`;
      drawingXml = `${XML_HEAD}<xdr:wsDr xmlns:xdr="${NS.xdr}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"></xdr:wsDr>`;
      const rel = addRelationship(sheetRels, NS.relDrawing, `../drawings/${drawingPath.split('/').pop()}`);
      sheetRels = rel.xml;
      const tag = `<drawing r:id="${rel.id}"/>`;
      const before = AFTER_DRAWING.map((name) => sheetXml.search(new RegExp(`<${name}[\\s/>]`))).filter((i) => i >= 0);
      const at = before.length ? Math.min(...before) : sheetXml.lastIndexOf('</worksheet>');
      sheetXml = `${sheetXml.slice(0, at)}${tag}${sheetXml.slice(at)}`;
      if (!/xmlns:r=/.test(/<worksheet\b[^>]*>/.exec(sheetXml)?.[0] ?? '')) sheetXml = sheetXml.replace('<worksheet ', `<worksheet xmlns:r="${NS.r}" `);
      zip.file(sheetPath, sheetXml);
      zip.file(sheetRelsPath, sheetRels);
      override(`/${drawingPath}`, NS.ctDrawing);
    }

    const drawingRelsPath = `${drawingPath.slice(0, drawingPath.lastIndexOf('/'))}/_rels/${drawingPath.split('/').pop()}.rels`;
    let drawingRels = await zip.file(drawingRelsPath)?.async('string') ?? null;
    let shapeId = Math.max(1, ...[...drawingXml.matchAll(/cNvPr id="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
    const anchors: string[] = [];
    for (const part of own) {
      const chartPath = `xl/charts/chart${nextPartIndex(zip, 'xl/charts', 'chart')}.xml`;
      zip.file(chartPath, part.xml);
      override(`/${chartPath}`, NS.ctChart);
      const rel = addRelationship(drawingRels, NS.relChart, `../charts/${chartPath.split('/').pop()}`);
      drawingRels = rel.xml;
      anchors.push(anchorXml(part.chart, shapeId++, rel.id));
    }
    zip.file(drawingPath, drawingXml.replace('</xdr:wsDr>', `${anchors.join('')}</xdr:wsDr>`));
    zip.file(drawingRelsPath, drawingRels!);
  }
  zip.file('[Content_Types].xml', types);
  return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), skipped };
}
