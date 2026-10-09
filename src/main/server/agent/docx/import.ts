import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/core';
import { createDocumentContent, safeFont, safeHex, type DocumentContent, type DocumentTypography } from '../../../../shared/documentContent';
import { attr, child, childrenNamed, elements, onOff, parseXml, textOf, type XmlNode } from './xml';

export interface RunProps { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string; size?: number; font?: string; highlight?: string; vert?: 'superscript' | 'subscript' }
export interface ParaProps { align?: string; left?: number; firstLine?: number; before?: number; after?: number; line?: number; numId?: string; ilvl?: number }
interface StyleDef { id: string; name: string; basedOn?: string; type: string; run: RunProps; para: ParaProps }
export interface DocxPackage {
  zip: JSZip;
  documentPath: string;
  documentXml: string;
  styles: Map<string, StyleDef>;
  defaultParagraphStyle?: string;
  docRun: RunProps; docPara: ParaProps;
  rels: Map<string, { target: string; external: boolean }>;
  numbering: Map<string, { ordered: boolean }[]>;
}

const HIGHLIGHTS: Record<string, string> = { yellow: 'ffff00', green: '00ff00', cyan: '00ffff', magenta: 'ff00ff', blue: '0000ff', red: 'ff0000', darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000', darkYellow: '808000', darkGray: '808080', lightGray: 'c0c0c0', black: '000000', white: 'ffffff' };

export function readRunProps(base: RunProps, rPr: XmlNode | undefined): RunProps {
  const out: RunProps = { ...base };
  if (!rPr) return out;
  for (const node of elements(rPr)) {
    switch (node.name) {
      case 'w:b': out.bold = onOff(node); break;
      case 'w:i': out.italic = onOff(node); break;
      case 'w:strike': case 'w:dstrike': out.strike = onOff(node); break;
      case 'w:u': out.underline = attr(node, 'w:val') !== 'none'; break;
      case 'w:color': { const hex = safeHex(attr(node, 'w:val')); if (hex) out.color = hex; else if (attr(node, 'w:val') === 'auto') delete out.color; break; }
      case 'w:sz': { const half = Number(attr(node, 'w:val')); if (Number.isFinite(half) && half > 0) out.size = half / 2; break; }
      case 'w:rFonts': {
        const names = [attr(node, 'w:ascii'), attr(node, 'w:hAnsi'), attr(node, 'w:eastAsia')].filter((v): v is string => Boolean(v));
        const font = safeFont([...new Set(names)].join(','));
        if (font) out.font = font;
        break;
      }
      case 'w:highlight': { const hex = HIGHLIGHTS[attr(node, 'w:val') ?? '']; if (hex) out.highlight = hex; else delete out.highlight; break; }
      case 'w:shd': { const hex = safeHex(attr(node, 'w:fill')); if (hex && attr(node, 'w:val') !== 'nil') out.highlight = hex; break; }
      case 'w:vertAlign': { const v = attr(node, 'w:val'); if (v === 'superscript' || v === 'subscript') out.vert = v; else delete out.vert; break; }
      default: break;
    }
  }
  return out;
}

export function readParaProps(base: ParaProps, pPr: XmlNode | undefined): ParaProps {
  const out: ParaProps = { ...base };
  if (!pPr) return out;
  const jc = attr(child(pPr, 'w:jc'), 'w:val');
  if (jc) out.align = jc === 'both' || jc === 'distribute' ? 'justify' : jc === 'start' || jc === 'left' ? 'left' : jc === 'end' || jc === 'right' ? 'right' : jc === 'center' ? 'center' : out.align;
  const ind = child(pPr, 'w:ind');
  if (ind) {
    const num = (name: string, alt?: string) => { const v = Number(attr(ind, name) ?? (alt ? attr(ind, alt) : undefined)); return Number.isFinite(v) ? v : undefined; };
    const left = num('w:left', 'w:start'); if (left !== undefined) out.left = left;
    const first = num('w:firstLine'); const hanging = num('w:hanging');
    if (hanging !== undefined) out.firstLine = -hanging; else if (first !== undefined) out.firstLine = first;
  }
  const spacing = child(pPr, 'w:spacing');
  if (spacing) {
    const before = Number(attr(spacing, 'w:before')); if (Number.isFinite(before)) out.before = before;
    const after = Number(attr(spacing, 'w:after')); if (Number.isFinite(after)) out.after = after;
    const line = Number(attr(spacing, 'w:line'));
    if (Number.isFinite(line) && (attr(spacing, 'w:lineRule') ?? 'auto') === 'auto') out.line = Math.round((line / 240) * 100) / 100;
  }
  const numPr = child(pPr, 'w:numPr');
  if (numPr) {
    const numId = attr(child(numPr, 'w:numId'), 'w:val'); const ilvl = Number(attr(child(numPr, 'w:ilvl'), 'w:val') ?? 0);
    if (numId !== undefined) { out.numId = numId; out.ilvl = Number.isFinite(ilvl) ? ilvl : 0; }
  }
  return out;
}

async function readText(zip: JSZip, name: string): Promise<string | undefined> { return zip.file(name)?.async('string'); }

function parseRels(xml: string | undefined): DocxPackage['rels'] {
  const rels: DocxPackage['rels'] = new Map();
  if (!xml) return rels;
  for (const rel of childrenNamed(parseXml(xml).children.find((n) => n.name === 'Relationships'), 'Relationship')) {
    rels.set(rel.attrs.Id, { target: rel.attrs.Target ?? '', external: rel.attrs.TargetMode === 'External' });
  }
  return rels;
}

export async function loadDocxPackage(bytes: Buffer | Uint8Array): Promise<DocxPackage> {
  const zip = await JSZip.loadAsync(bytes);
  const documentPath = 'word/document.xml';
  const documentXml = await readText(zip, documentPath);
  if (!documentXml) throw new Error('不是有效的 Word 文档');
  const styles = new Map<string, StyleDef>(); let docRun: RunProps = {}; let docPara: ParaProps = {}; let defaultParagraphStyle: string | undefined;
  const stylesXml = await readText(zip, 'word/styles.xml');
  if (stylesXml) {
    const root = child(parseXml(stylesXml), 'w:styles');
    const defaults = child(root, 'w:docDefaults');
    docRun = readRunProps({}, child(child(defaults, 'w:rPrDefault'), 'w:rPr'));
    docPara = readParaProps({}, child(child(defaults, 'w:pPrDefault'), 'w:pPr'));
    for (const style of childrenNamed(root, 'w:style')) {
      const id = attr(style, 'w:styleId'); if (!id) continue;
      const type = attr(style, 'w:type') ?? 'paragraph';
      styles.set(id, { id, type, name: attr(child(style, 'w:name'), 'w:val') ?? id, basedOn: attr(child(style, 'w:basedOn'), 'w:val'), run: readRunProps({}, child(style, 'w:rPr')), para: readParaProps({}, child(style, 'w:pPr')) });
      if (type === 'paragraph' && attr(style, 'w:default') === '1') defaultParagraphStyle = id;
    }
  }
  const numbering: DocxPackage['numbering'] = new Map();
  const numberingXml = await readText(zip, 'word/numbering.xml');
  if (numberingXml) {
    const root = child(parseXml(numberingXml), 'w:numbering');
    const abstracts = new Map<string, { ordered: boolean }[]>();
    for (const abs of childrenNamed(root, 'w:abstractNum')) {
      abstracts.set(attr(abs, 'w:abstractNumId') ?? '', childrenNamed(abs, 'w:lvl').map((lvl) => ({ ordered: !['bullet', 'none'].includes(attr(child(lvl, 'w:numFmt'), 'w:val') ?? 'decimal') })));
    }
    for (const num of childrenNamed(root, 'w:num')) {
      const levels = abstracts.get(attr(child(num, 'w:abstractNumId'), 'w:val') ?? '');
      if (levels) numbering.set(attr(num, 'w:numId') ?? '', levels);
    }
  }
  return { zip, documentPath, documentXml, styles, defaultParagraphStyle, docRun, docPara, rels: parseRels(await readText(zip, 'word/_rels/document.xml.rels')), numbering };
}

function styleChain(pkg: DocxPackage, id: string | undefined): StyleDef[] {
  const chain: StyleDef[] = []; const seen = new Set<string>();
  for (let cursor = id; cursor && !seen.has(cursor); ) {
    seen.add(cursor); const style = pkg.styles.get(cursor); if (!style) break;
    chain.unshift(style); cursor = style.basedOn;
  }
  return chain;
}
export function baselineRun(pkg: DocxPackage): RunProps {
  return styleChain(pkg, pkg.defaultParagraphStyle).reduce((run, style) => ({ ...run, ...style.run }), pkg.docRun);
}
export function baselinePara(pkg: DocxPackage): ParaProps {
  return styleChain(pkg, pkg.defaultParagraphStyle).reduce((para, style) => ({ ...para, ...style.para }), pkg.docPara);
}

type Mark = { type: string; attrs?: Record<string, unknown> };
interface Context { pkg: DocxPackage; baseRun: RunProps; basePara: ParaProps; warnings: Set<string>; mediaCount: number }
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

function headingLevel(pkg: DocxPackage, styleId: string | undefined): number | undefined {
  for (const style of styleChain(pkg, styleId).reverse()) {
    const m = /^heading\s*([1-6])$/i.exec(style.name.trim()); if (m) return Number(m[1]);
    if (/^title$/i.test(style.name.trim())) return 1;
  }
  return undefined;
}

function marksFor(run: RunProps, ctx: Context, link?: string): Mark[] {
  const marks: Mark[] = [];
  if (run.bold) marks.push({ type: 'bold' });
  if (run.italic) marks.push({ type: 'italic' });
  if (run.underline) marks.push({ type: 'underline' });
  if (run.strike) marks.push({ type: 'strike' });
  const base = ctx.baseRun;
  const attrs = {
    color: run.color && run.color !== base.color ? run.color : null,
    size: run.size && run.size !== base.size ? run.size : null,
    font: run.font && run.font !== base.font ? run.font : null,
    highlight: run.highlight ?? null,
    vert: run.vert ?? null,
  };
  if (Object.values(attrs).some((v) => v !== null)) marks.push({ type: 'runStyle', attrs });
  if (link) marks.push({ type: 'link', attrs: { href: link } });
  return marks;
}

interface InlinePiece { kind: 'text'; text: string; marks: Mark[] }
interface ImagePiece { kind: 'image'; node: JSONContent }
interface BreakPiece { kind: 'break' }
type Piece = InlinePiece | ImagePiece | BreakPiece;

async function readImage(ctx: Context, drawing: XmlNode): Promise<JSONContent | undefined> {
  let blip: XmlNode | undefined; let extent: XmlNode | undefined; let docPr: XmlNode | undefined;
  const walk = (node: XmlNode) => { for (const c of node.children) { if (c.name === 'a:blip') blip ??= c; else if (c.name === 'wp:extent') extent ??= c; else if (c.name === 'wp:docPr') docPr ??= c; walk(c); } };
  walk(drawing);
  const rid = attr(blip, 'r:embed');
  const rel = rid ? ctx.pkg.rels.get(rid) : undefined;
  if (!rel || rel.external) { ctx.warnings.add('部分图片无法读取，已保留在原文件中。'); return undefined; }
  const target = rel.target.startsWith('/') ? rel.target.slice(1) : `word/${rel.target}`.replace(/\/\.\//g, '/');
  const ext = target.split('.').pop()?.toLowerCase() ?? '';
  const mime = IMAGE_TYPES[ext];
  const file = ctx.pkg.zip.file(target);
  if (!mime || !file) { ctx.warnings.add(`有图片格式（.${ext}）暂不能在编辑器显示，已保留在原文件中。`); return undefined; }
  const data = await file.async('base64');
  if (data.length > 2_000_000) { ctx.warnings.add('有较大的图片未在编辑器显示，已保留在原文件中。'); return undefined; }
  const cx = Number(attr(extent, 'cx'));
  return { type: 'image', attrs: { src: `data:${mime};base64,${data}`, alt: attr(docPr, 'descr') ?? null, ...(Number.isFinite(cx) && cx > 0 ? { width: Math.round(cx / 9525) } : {}) } };
}

async function collectInline(node: XmlNode, ctx: Context, run: RunProps, link: string | undefined, out: Piece[]): Promise<void> {
  for (const c of node.children) {
    switch (c.name) {
      case 'w:r': {
        let effective = run;
        const rStyle = attr(child(child(c, 'w:rPr'), 'w:rStyle'), 'w:val');
        if (rStyle) effective = styleChain(ctx.pkg, rStyle).reduce((acc, s) => ({ ...acc, ...s.run }), effective);
        effective = readRunProps(effective, child(c, 'w:rPr'));
        for (const part of c.children) {
          if (part.name === 'w:t') out.push({ kind: 'text', text: textOf(part), marks: marksFor(effective, ctx, link) });
          else if (part.name === 'w:tab') out.push({ kind: 'text', text: '\t', marks: marksFor(effective, ctx, link) });
          else if (part.name === 'w:noBreakHyphen') out.push({ kind: 'text', text: '-', marks: marksFor(effective, ctx, link) });
          else if (part.name === 'w:cr' || (part.name === 'w:br' && (attr(part, 'w:type') ?? 'textWrapping') === 'textWrapping')) out.push({ kind: 'break' });
          else if (part.name === 'w:drawing') { const image = await readImage(ctx, part); if (image) out.push({ kind: 'image', node: image }); }
          else if (part.name === 'w:pict' || part.name === 'w:object') ctx.warnings.add('部分形状或旧式图片无法在编辑器显示，已保留在原文件中。');
        }
        break;
      }
      case 'w:hyperlink': {
        const rid = attr(c, 'r:id'); const anchor = attr(c, 'w:anchor');
        const rel = rid ? ctx.pkg.rels.get(rid) : undefined;
        const href = rel?.external ? rel.target : anchor ? `#${anchor}` : undefined;
        await collectInline(c, ctx, run, href && /^(https?:\/\/|mailto:|tel:|#)/i.test(href) ? href : link, out);
        break;
      }
      case 'w:ins': case 'w:moveTo': case 'w:fldSimple': case 'w:smartTag': case 'w:customXml': case 'w:dir': case 'w:bdo':
        await collectInline(c, ctx, run, link, out); break;
      case 'w:sdt': { const content = child(c, 'w:sdtContent'); if (content) await collectInline(content, ctx, run, link, out); break; }
      default: break; // w:del, bookmarks, proofing marks, comment anchors: not part of the editable text
    }
  }
}

function inlineNodes(pieces: Piece[]): JSONContent[] {
  const nodes: JSONContent[] = [];
  for (const piece of pieces) {
    if (piece.kind === 'break') { nodes.push({ type: 'hardBreak' }); continue; }
    if (piece.kind !== 'text' || !piece.text) continue;
    const last = nodes[nodes.length - 1];
    if (last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(piece.marks)) last.text += piece.text;
    else nodes.push({ type: 'text', text: piece.text, ...(piece.marks.length ? { marks: piece.marks } : {}) });
  }
  return nodes;
}

const PPR_MODELED = new Set(['w:pStyle', 'w:numPr', 'w:spacing', 'w:ind', 'w:jc', 'w:rPr', 'w:sectPr', 'w:pPrChange']);
function paragraphAttrs(ctx: Context, pPr: XmlNode | undefined, styleId: string | undefined, xml: string): { attrs: Record<string, unknown>; para: ParaProps } {
  const chain = styleChain(ctx.pkg, styleId);
  const para = readParaProps(chain.reduce((acc, s) => ({ ...acc, ...s.para }), ctx.basePara), pPr);
  const base = ctx.basePara;
  const extra = elements(pPr ?? { children: [] } as unknown as XmlNode).filter((n) => !PPR_MODELED.has(n.name)).map((n) => xml.slice(n.start, n.end)).join('');
  return { para, attrs: {
    textAlign: para.align && para.align !== (base.align ?? 'left') ? para.align : null,
    indentLeft: para.left && para.left !== base.left ? para.left : null,
    indentFirst: para.firstLine && para.firstLine !== base.firstLine ? para.firstLine : null,
    spaceBefore: para.before !== undefined && para.before !== base.before ? para.before : null,
    spaceAfter: para.after !== undefined && para.after !== base.after ? para.after : null,
    lineSpacing: para.line !== undefined && para.line !== base.line ? para.line : null,
    pStyle: styleId && styleId !== ctx.pkg.defaultParagraphStyle ? styleId : null,
    pPrExtra: extra || null,
  } };
}

interface ParagraphResult { nodes: JSONContent[]; para: ParaProps; heading?: number; listKind?: { numId: string; ilvl: number; ordered: boolean } }
async function importParagraph(p: XmlNode, ctx: Context, xml: string): Promise<ParagraphResult> {
  const pPr = child(p, 'w:pPr');
  const styleId = attr(child(pPr, 'w:pStyle'), 'w:val');
  const chain = styleChain(ctx.pkg, styleId);
  const { attrs, para } = paragraphAttrs(ctx, pPr, styleId, xml);
  const styleRun = chain.reduce((acc, s) => ({ ...acc, ...s.run }), ctx.baseRun);
  const pieces: Piece[] = [];
  await collectInline(p, ctx, styleRun, undefined, pieces);
  const heading = headingLevel(ctx.pkg, styleId);
  const type = heading ? 'heading' : 'paragraph';
  const nodes: JSONContent[] = []; let run: Piece[] = [];
  const flush = (force: boolean) => {
    const content = inlineNodes(run);
    if (content.length || force) nodes.push({ type, attrs: { ...attrs, ...(heading ? { level: heading } : {}) }, ...(content.length ? { content } : {}) });
    run = [];
  };
  const hasImage = pieces.some((piece) => piece.kind === 'image');
  for (const piece of pieces) {
    if (piece.kind === 'image') { flush(false); nodes.push(piece.node); } else run.push(piece);
  }
  flush(!hasImage);
  let listKind: ParagraphResult['listKind'];
  if (!heading && para.numId && para.numId !== '0') {
    const levels = ctx.pkg.numbering.get(para.numId);
    if (levels) listKind = { numId: para.numId, ilvl: para.ilvl ?? 0, ordered: levels[Math.min(para.ilvl ?? 0, levels.length - 1)]?.ordered ?? false };
  }
  return { nodes, para, heading, listKind };
}

async function importCell(tc: XmlNode, ctx: Context, xml: string): Promise<JSONContent[]> {
  const blocks = await importBlocks(tc.children.filter((n) => n.name === 'w:p' || n.name === 'w:tbl' || n.name === 'w:sdt'), ctx, xml);
  return blocks.length ? blocks : [{ type: 'paragraph' }];
}

async function importTable(tbl: XmlNode, ctx: Context, xml: string): Promise<JSONContent> {
  const grid = childrenNamed(child(tbl, 'w:tblGrid'), 'w:gridCol').map((col) => Number(attr(col, 'w:w')));
  const open: { cell: JSONContent & { attrs: Record<string, unknown> }; col: number }[] = [];
  const rows: JSONContent[] = [];
  for (const tr of childrenNamed(tbl, 'w:tr')) {
    const header = Boolean(child(child(tr, 'w:trPr'), 'w:tblHeader'));
    const cells: JSONContent[] = []; let col = 0;
    for (const tc of childrenNamed(tr, 'w:tc')) {
      const tcPr = child(tc, 'w:tcPr');
      const span = Math.max(1, Number(attr(child(tcPr, 'w:gridSpan'), 'w:val') ?? 1) || 1);
      const merge = child(tcPr, 'w:vMerge');
      if (merge && (attr(merge, 'w:val') ?? 'continue') === 'continue') {
        const owner = open.find((o) => o.col === col);
        if (owner) { owner.cell.attrs.rowspan = Number(owner.cell.attrs.rowspan) + 1; col += span; continue; }
      }
      const widths = grid.slice(col, col + span);
      const cell = { type: header ? 'tableHeader' : 'tableCell', attrs: {
        colspan: span, rowspan: 1,
        colwidth: widths.length === span && widths.every((w) => Number.isFinite(w) && w > 0) ? widths.map((w) => Math.max(20, Math.round(w / 15))) : null,
        background: safeHex(attr(child(tcPr, 'w:shd'), 'w:fill')),
      }, content: await importCell(tc, ctx, xml) } as JSONContent & { attrs: Record<string, unknown> };
      for (let i = open.length - 1; i >= 0; i--) if (open[i].col === col) open.splice(i, 1);
      if (merge) open.push({ cell, col });
      cells.push(cell); col += span;
    }
    rows.push({ type: 'tableRow', content: cells });
  }
  const tblPr = child(tbl, 'w:tblPr');
  return { type: 'table', attrs: { tblPr: tblPr ? xml.slice(tblPr.openEnd, tblPr.closeStart) : null }, content: rows.length ? rows : [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] };
}

/** Nodes for a sequence of block-level OOXML elements, nesting consecutive list paragraphs. */
async function importBlocks(blocks: XmlNode[], ctx: Context, xml: string): Promise<JSONContent[]> {
  const out: JSONContent[] = [];
  interface Level { node: JSONContent; numId: string; ordered: boolean; ilvl: number }
  let stack: Level[] = [];
  const closeLists = () => { stack = []; };
  const pushList = (target: JSONContent[], kind: NonNullable<ParagraphResult['listKind']>) => {
    const node: JSONContent = { type: kind.ordered ? 'orderedList' : 'bulletList', attrs: { numId: kind.numId }, content: [] };
    target.push(node); stack.push({ node, numId: kind.numId, ordered: kind.ordered, ilvl: kind.ilvl }); return node;
  };
  for (const block of blocks) {
    if (block.name === 'w:sdt') { const inner = child(block, 'w:sdtContent'); if (inner) { closeLists(); out.push(...await importBlocks(elements(inner), ctx, xml)); } continue; }
    if (block.name === 'w:tbl') { closeLists(); out.push(await importTable(block, ctx, xml)); continue; }
    if (block.name !== 'w:p') continue;
    const result = await importParagraph(block, ctx, xml);
    if (!result.listKind) { closeLists(); out.push(...result.nodes); continue; }
    const kind = result.listKind;
    while (stack.length && (stack[stack.length - 1].ilvl > kind.ilvl || (stack[stack.length - 1].ilvl === kind.ilvl && (stack[stack.length - 1].numId !== kind.numId || stack[stack.length - 1].ordered !== kind.ordered)))) stack.pop();
    if (!stack.length) pushList(out, kind);
    else if (stack[stack.length - 1].ilvl < kind.ilvl) {
      const parentList = stack[stack.length - 1].node; const lastItem = parentList.content?.[parentList.content.length - 1];
      if (lastItem) pushList(lastItem.content ??= [], kind); else pushList(out, kind);
    }
    const current = stack[stack.length - 1].node;
    current.content!.push({ type: 'listItem', content: result.nodes.filter((n) => n.type === 'paragraph' || n.type === 'image').length ? result.nodes.map((n) => n.type === 'heading' ? { ...n, type: 'paragraph' } : n) : [{ type: 'paragraph' }] });
  }
  return out;
}

const sourceHash = (nodes: JSONContent[]) => createHash('sha1').update(canonical(nodes)).digest('hex').slice(0, 16);
/** Stable JSON of nodes without identity/source bookkeeping, used to detect edits. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (key, v) => {
    if (key === 'id' || key === 'srcKey' || key === 'srcHash') return undefined;
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && x !== undefined).sort(([a], [b]) => a < b ? -1 : 1));
    return v;
  });
}
export { sourceHash };

export async function importDocxFidelity(bytes: Buffer | Uint8Array): Promise<DocumentContent> {
  const pkg = await loadDocxPackage(bytes);
  const root = child(parseXml(pkg.documentXml), 'w:document');
  const body = child(root, 'w:body');
  if (!body) throw new Error('Word 文档缺少正文');
  const ctx: Context = { pkg, baseRun: baselineRun(pkg), basePara: baselinePara(pkg), warnings: new Set(), mediaCount: 0 };
  const children = elements(body);
  const doc: JSONContent[] = []; const groups: string[] = [];
  let index = 0;
  while (index < children.length) {
    const el = children[index];
    if (el.name === 'w:p' || el.name === 'w:tbl' || el.name === 'w:sdt') {
      // A list spans consecutive paragraphs; everything else is one body child per group.
      let last = index;
      const listy = (node: XmlNode) => node.name === 'w:p' && Boolean(child(child(node, 'w:pPr'), 'w:numPr'));
      if (listy(el)) while (last + 1 < children.length && listy(children[last + 1])) last++;
      const nodes = await importBlocks(children.slice(index, last + 1), ctx, pkg.documentXml);
      if (nodes.length) {
        const key = `${index}-${last}`;
        groups.push(key);
        for (const node of nodes) node.attrs = { ...node.attrs, srcKey: key };
        doc.push(...nodes);
      }
      index = last + 1;
    } else index++;
  }
  const base = ctx.baseRun;
  const typography: DocumentTypography = {};
  if (base.font) typography.fontFamily = base.font;
  if (base.size) typography.fontSize = base.size;
  if (ctx.basePara.line) typography.lineHeight = ctx.basePara.line;
  // Hash the schema-normalised form so export compares like with like.
  const normalized = createDocumentContent({ type: 'doc', content: doc.length ? doc : [{ type: 'paragraph' }] });
  const byKey = new Map<string, JSONContent[]>();
  for (const node of normalized.doc.content ?? []) { const key = node.attrs?.srcKey as string | undefined; if (key) byKey.set(key, [...(byKey.get(key) ?? []), node]); }
  for (const [key, nodes] of byKey) { const hash = sourceHash(nodes); for (const node of nodes) node.attrs = { ...node.attrs, srcKey: key, srcHash: hash }; }
  const content = createDocumentContent(normalized.doc);
  return { ...content, docx: { groups, typography }, importWarnings: [
    '已按原文件样式导入，导出时未改动的内容将保持原样。页眉页脚、页边距和分页不在编辑器内显示，但会保留在文件中。',
    ...ctx.warnings,
  ] };
}
