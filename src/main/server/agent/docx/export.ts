import type { JSONContent } from '@tiptap/core';
import { documentSchema, safeFont, safeHex, type DocumentContent } from '../../../../shared/documentContent';
import { loadDocxPackage, sourceHash, type DocxPackage } from './import';
import { child, elements, escapeXml, parseXml } from './xml';
import { deleteParagraphs, diffText, insertRuns, originalParagraphs, revisionAttrs, type OriginalParagraph, type RevisionStamp } from './revisions';

const PPR_ORDER = ['w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr', 'w:widowControl', 'w:numPr', 'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs', 'w:suppressAutoHyphens', 'w:kinsoku', 'w:wordWrap', 'w:overflowPunct', 'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN', 'w:bidi', 'w:adjustRightInd', 'w:snapToGrid', 'w:spacing', 'w:ind', 'w:contextualSpacing', 'w:mirrorIndents', 'w:suppressOverlap', 'w:jc', 'w:textDirection', 'w:textAlignment', 'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange'];
const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const REL_LINK = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/;
const EXT: Record<string, string> = { png: 'png', jpeg: 'jpeg', gif: 'gif', webp: 'webp' };
const MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/** Tracked-changes export: which new paragraphs are insertions, and which edited ones to diff against their original text. */
interface Revise { stamp: RevisionStamp; modes: Map<JSONContent, OriginalParagraph | 'inserted'> }
interface Writer { pkg: DocxPackage; rels: string[]; links: Map<string, string>; media: Map<string, Buffer>; exts: Set<string>; counter: number; docPr: number; revise?: Revise }
type Attrs = Record<string, unknown>;
const attrsOf = (node: JSONContent): Attrs => node.attrs ?? {};
const num = (value: unknown): number | undefined => { const n = Number(value); return value !== null && value !== undefined && Number.isFinite(n) ? n : undefined; };

function nextRel(w: Writer, type: string, target: string, external: boolean): string {
  const id = `rIdReizo${++w.counter}`;
  w.rels.push(`<Relationship Id="${id}" Type="${type}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ''}/>`);
  return id;
}

function sniffImage(bytes: Buffer): { w: number; h: number } | null {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  if (bytes.length > 10 && bytes.toString('latin1', 0, 3) === 'GIF') return { w: bytes.readUInt16LE(6), h: bytes.readUInt16LE(8) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length; ) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
      i += 2 + bytes.readUInt16BE(i + 2);
    }
  }
  return null;
}

function runProps(marks: JSONContent['marks'], linked: boolean): string {
  let font = ''; let bold = ''; let italic = ''; let strike = ''; let color = ''; let size = ''; let highlight = ''; let underline = ''; let vert = '';
  for (const mark of marks ?? []) {
    const a = (mark.attrs ?? {}) as Attrs;
    if (mark.type === 'bold') bold = '<w:b/>';
    else if (mark.type === 'italic') italic = '<w:i/>';
    else if (mark.type === 'strike') strike = '<w:strike/>';
    else if (mark.type === 'underline') underline = '<w:u w:val="single"/>';
    else if (mark.type === 'code') font = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/>';
    else if (mark.type === 'runStyle') {
      const f = safeFont(a.font); if (f) { const names = f.split(',').map((n) => escapeXml(n.trim())); font = `<w:rFonts w:ascii="${names[0]}" w:hAnsi="${names[0]}" w:eastAsia="${names[names.length - 1]}"/>`; }
      const c = safeHex(a.color); if (c) color = `<w:color w:val="${c.toUpperCase()}"/>`;
      const s = num(a.size); if (s && s > 0 && s <= 400) size = `<w:sz w:val="${Math.round(s * 2)}"/><w:szCs w:val="${Math.round(s * 2)}"/>`;
      const h = safeHex(a.highlight); if (h) highlight = `<w:shd w:val="clear" w:color="auto" w:fill="${h.toUpperCase()}"/>`;
      if (a.vert === 'superscript' || a.vert === 'subscript') vert = `<w:vertAlign w:val="${a.vert}"/>`;
    }
  }
  if (linked) { if (!color) color = '<w:color w:val="0563C1"/>'; if (!underline) underline = '<w:u w:val="single"/>'; }
  // Element order follows the CT_RPr sequence Word validates against.
  const xml = font + bold + italic + strike + color + size + underline + highlight + vert;
  return xml ? `<w:rPr>${xml}</w:rPr>` : '';
}

function textRuns(text: string, rPr: string): string {
  return text.split('\t').map((part, i) => (i ? `<w:r>${rPr}<w:tab/></w:r>` : '') + (part ? `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>` : '')).join('');
}

function inlineXml(nodes: JSONContent[] | undefined, w: Writer): string {
  let out = ''; let openLink: string | undefined; let buffer = '';
  const flush = () => { if (!buffer) return; out += openLink ? `<w:hyperlink r:id="${openLink}" w:history="1">${buffer}</w:hyperlink>` : buffer; buffer = ''; openLink = undefined; };
  for (const node of nodes ?? []) {
    if (node.type === 'hardBreak') { flush(); out += '<w:r><w:br/></w:r>'; continue; }
    if (node.type !== 'text' || !node.text) continue;
    const href = node.marks?.find((m) => m.type === 'link')?.attrs?.href as string | undefined;
    let rel: string | undefined;
    if (href && !href.startsWith('#')) { rel = w.links.get(href); if (!rel) { rel = nextRel(w, REL_LINK, href, true); w.links.set(href, rel); } }
    if (href?.startsWith('#')) { flush(); out += `<w:hyperlink w:anchor="${escapeXml(href.slice(1))}" w:history="1">${textRuns(node.text, runProps(node.marks, true))}</w:hyperlink>`; continue; }
    if (rel !== openLink) flush();
    openLink = rel; buffer += textRuns(node.text, runProps(node.marks, Boolean(rel)));
  }
  flush();
  return out;
}

/** The paragraph's runs as a diff against its original text: unchanged runs as-is, `<w:del>` for removed text, `<w:ins>` for added. Null when it cannot be expressed (links, images). */
function revisedInline(node: JSONContent, original: OriginalParagraph, stamp: RevisionStamp): string | null {
  const segs: { text: string; marks: JSONContent['marks'] }[] = [];
  for (const n of node.content ?? []) {
    if (n.type === 'hardBreak') segs.push({ text: '\n', marks: undefined });
    else if (n.type === 'text' && n.text) { if (n.marks?.some((m) => m.type === 'link')) return null; segs.push({ text: n.text, marks: n.marks }); }
    else return null;
  }
  const next = segs.map((seg) => seg.text).join('');
  if (next === original.text) return null;
  const runs = (from: number, to: number): string => {
    let out = ''; let offset = 0;
    for (const seg of segs) {
      const a = Math.max(from, offset); const b = Math.min(to, offset + seg.text.length);
      if (b > a) out += seg.text.slice(a - offset, b - offset).split('\n').map((part, i) => (i ? '<w:r><w:br/></w:r>' : '') + textRuns(part, runProps(seg.marks, false))).join('');
      offset += seg.text.length;
    }
    return out;
  };
  let pos = 0; let out = '';
  for (const op of diffText(original.text, next)) {
    if (op.op === 'eq') { out += runs(pos, pos + op.text.length); pos += op.text.length; }
    else if (op.op === 'ins') { out += insertRuns(runs(pos, pos + op.text.length), stamp); pos += op.text.length; }
    else {
      const body = op.text.split(/(\t|\n)/).map((part) => (part === '\t' ? '<w:tab/>' : part === '\n' ? '<w:br/>' : part ? `<w:delText xml:space="preserve">${escapeXml(part)}</w:delText>` : '')).join('');
      out += `<w:del ${revisionAttrs(stamp)}><w:r>${original.rPr}${body}</w:r></w:del>`;
    }
  }
  return out;
}

function sortPPr(parts: { name: string; xml: string }[]): string {
  const rank = (name: string) => { const i = PPR_ORDER.indexOf(name); return i < 0 ? PPR_ORDER.length : i; };
  return parts.sort((a, b) => rank(a.name) - rank(b.name)).map((p) => p.xml).join('');
}

interface ParaOptions { numPr?: { numId: string; ilvl: number }; indentExtra?: number; style?: string; prefix?: string }
function headingStyleId(w: Writer, level: number): string | undefined {
  for (const style of w.pkg.styles.values()) if (new RegExp(`^heading\\s*${level}$`, 'i').test(style.name.trim())) return style.id;
  return undefined;
}

function paragraphXml(node: JSONContent, w: Writer, opts: ParaOptions = {}): string {
  const a = attrsOf(node);
  const parts: { name: string; xml: string }[] = [];
  let styleId = typeof a.pStyle === 'string' ? a.pStyle : opts.style && w.pkg.styles.has(opts.style) ? opts.style : undefined;
  let headingRun = false;
  if (node.type === 'heading') {
    const level = Math.min(6, Math.max(1, Number(a.level) || 1));
    if (!styleId) { styleId = headingStyleId(w, level); headingRun = !styleId; }
  }
  if (styleId && /^[\w.-]+$/.test(styleId)) parts.push({ name: 'w:pStyle', xml: `<w:pStyle w:val="${styleId}"/>` });
  if (opts.numPr) parts.push({ name: 'w:numPr', xml: `<w:numPr><w:ilvl w:val="${opts.numPr.ilvl}"/><w:numId w:val="${opts.numPr.numId}"/></w:numPr>` });
  if (typeof a.pPrExtra === 'string' && a.pPrExtra) {
    try { const holder = parseXml(`<x>${a.pPrExtra}</x>`).children[0]; for (const el of elements(holder)) parts.push({ name: el.name, xml: a.pPrExtra.slice(el.start - 3, el.end - 3) }); } catch { /* ignore malformed extras */ }
  }
  const before = num(a.spaceBefore); const after = num(a.spaceAfter); const exact = num(a.lineExact); const line = exact === undefined ? num(a.lineSpacing) : undefined;
  if (before !== undefined || after !== undefined || line !== undefined || exact !== undefined) parts.push({ name: 'w:spacing', xml: `<w:spacing${before !== undefined ? ` w:before="${Math.round(before)}"` : ''}${after !== undefined ? ` w:after="${Math.round(after)}"` : ''}${exact !== undefined ? ` w:line="${Math.round(exact * 20)}" w:lineRule="exact"` : line !== undefined ? ` w:line="${Math.round(line * 240)}" w:lineRule="auto"` : ''}/>` });
  const left = (num(a.indentLeft) ?? 0) + (opts.indentExtra ?? 0); const first = num(a.indentFirst);
  if (left || first) parts.push({ name: 'w:ind', xml: `<w:ind${left ? ` w:left="${Math.round(left)}"` : ''}${first ? (first < 0 ? ` w:hanging="${Math.round(-first)}"` : ` w:firstLine="${Math.round(first)}"`) : ''}/>` });
  const jc = { left: 'left', center: 'center', right: 'right', justify: 'both' }[String(a.textAlign) as 'left'];
  if (jc) parts.push({ name: 'w:jc', xml: `<w:jc w:val="${jc}"/>` });
  const mode = w.revise?.modes.get(node);
  let body: string;
  if (mode === 'inserted' && w.revise) {
    body = insertRuns(inlineXml(node.content, w), w.revise.stamp);
    if (!parts.some((p) => p.name === 'w:rPr')) parts.push({ name: 'w:rPr', xml: `<w:rPr><w:ins ${revisionAttrs(w.revise.stamp)}/></w:rPr>` });
  } else body = (typeof mode === 'object' && w.revise ? revisedInline(node, mode, w.revise.stamp) : null) ?? inlineXml(node.content, w);
  if (opts.prefix) body = `<w:r><w:t xml:space="preserve">${escapeXml(opts.prefix)}</w:t></w:r>${body}`;
  const pPr = parts.length ? `<w:pPr>${sortPPr(parts)}</w:pPr>` : '';
  if (headingRun) body = body.replace(/<w:rPr>/g, '<w:rPr><w:b/>').replace(/<w:r>(?!<w:rPr>)/g, '<w:r><w:rPr><w:b/></w:rPr>');
  return `<w:p>${pPr}${body}</w:p>`;
}

function imageXml(node: JSONContent, w: Writer): string {
  const a = attrsOf(node); const m = DATA_IMAGE.exec(String(a.src ?? ''));
  if (!m) return '<w:p/>';
  const bytes = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  const ext = EXT[m[1]]; const name = `reizo-${++w.counter}.${ext}`;
  w.media.set(`word/media/${name}`, bytes); w.exts.add(ext);
  const rid = nextRel(w, REL_IMAGE, `media/${name}`, false);
  const size = sniffImage(bytes);
  const widthPx = Math.min(num(a.width) ?? size?.w ?? 400, 600);
  const heightPx = num(a.height) ?? (size ? Math.round(widthPx * size.h / size.w) : Math.round(widthPx * 0.66));
  const cx = Math.round(widthPx * 9525); const cy = Math.round(heightPx * 9525); const id = ++w.docPr;
  const alt = escapeXml(String(a.alt ?? ''));
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${alt}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function resolveNumId(w: Writer, wanted: unknown, ordered: boolean): string | undefined {
  if (typeof wanted === 'string' && w.pkg.numbering.get(wanted)?.[0]?.ordered === ordered) return wanted;
  for (const [id, levels] of w.pkg.numbering) if (levels[0]?.ordered === ordered) return id;
  return undefined;
}

function listXml(node: JSONContent, w: Writer, depth: number): string {
  const ordered = node.type === 'orderedList'; const numId = resolveNumId(w, attrsOf(node).numId, ordered);
  let out = ''; let index = Number(attrsOf(node).start) || 1;
  for (const item of node.content ?? []) {
    let first = true;
    for (const part of item.content ?? []) {
      if (part.type === 'bulletList' || part.type === 'orderedList') { out += listXml(part, w, depth + 1); continue; }
      if (part.type === 'paragraph' || part.type === 'heading') {
        const levels = numId ? w.pkg.numbering.get(numId) : undefined;
        out += paragraphXml(part, w, numId && first ? { numPr: { numId, ilvl: Math.min(depth, (levels?.length ?? 1) - 1) }, style: 'ListParagraph' } : { indentExtra: 720 * (depth + 1), prefix: first && !numId ? (ordered ? `${index}. ` : '• ') : undefined });
        first = false; continue;
      }
      out += blockXml(part, w);
    }
    index++;
  }
  return out;
}

function tableXml(node: JSONContent, w: Writer): string {
  interface Cell { node?: JSONContent; col: number; span: number; vmerge?: 'restart' | 'continue'; header: boolean }
  const rem: number[] = []; const ownerSpan: number[] = []; const layout: Cell[][] = []; const widths: number[] = [];
  for (const row of node.content ?? []) {
    const cells: Cell[] = []; let col = 0;
    const fillContinuations = () => { while (rem[col] > 0) { cells.push({ col, span: ownerSpan[col] ?? 1, vmerge: 'continue', header: false }); const span = ownerSpan[col] ?? 1; for (let i = 0; i < span; i++) rem[col + i]--; col += span; } };
    for (const cell of row.content ?? []) {
      fillContinuations();
      const a = attrsOf(cell); const span = Math.max(1, num(a.colspan) ?? 1); const rowspan = Math.max(1, num(a.rowspan) ?? 1);
      const colwidth = Array.isArray(a.colwidth) ? a.colwidth as number[] : [];
      for (let i = 0; i < span; i++) if (colwidth[i] && !widths[col + i]) widths[col + i] = Math.round(colwidth[i] * 15);
      cells.push({ node: cell, col, span, vmerge: rowspan > 1 ? 'restart' : undefined, header: cell.type === 'tableHeader' });
      if (rowspan > 1) { ownerSpan[col] = span; for (let i = 0; i < span; i++) rem[col + i] = rowspan - 1; }
      col += span;
    }
    fillContinuations();
    while (col < rem.length) { if (rem[col] > 0) fillContinuations(); else col++; }
    layout.push(cells);
  }
  const cols = Math.max(1, ...layout.map((cells) => cells.reduce((m, c) => Math.max(m, c.col + c.span), 0)));
  const fallback = Math.max(600, Math.floor(9360 / cols));
  for (let i = 0; i < cols; i++) widths[i] ??= fallback;
  const raw = attrsOf(node).tblPr;
  const tblPr = typeof raw === 'string' && raw ? raw : '<w:tblW w:w="0" w:type="auto"/><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('') + '</w:tblBorders><w:tblLook w:val="04A0"/>';
  const rows = layout.map((cells) => {
    const header = cells.length > 0 && cells.every((c) => c.header || c.vmerge === 'continue') && cells.some((c) => c.header);
    const tcs = cells.map((c) => {
      const width = widths.slice(c.col, c.col + c.span).reduce((s, v) => s + v, 0);
      const bg = safeHex(attrsOf(c.node ?? {}).background);
      const tcPr = `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${c.span > 1 ? `<w:gridSpan w:val="${c.span}"/>` : ''}${c.vmerge === 'continue' ? '<w:vMerge/>' : c.vmerge === 'restart' ? '<w:vMerge w:val="restart"/>' : ''}${bg ? `<w:shd w:val="clear" w:color="auto" w:fill="${bg.toUpperCase()}"/>` : ''}</w:tcPr>`;
      let content = (c.node?.content ?? []).map((n) => blockXml(n, w)).join('');
      if (!content || !content.endsWith('</w:p>') && !content.endsWith('<w:p/>')) content += '<w:p/>';
      return `<w:tc>${tcPr}${content}</w:tc>`;
    }).join('');
    return `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${tcs}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tblGrid>${widths.slice(0, cols).map((v) => `<w:gridCol w:w="${v}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
}

function blockXml(node: JSONContent, w: Writer): string {
  switch (node.type) {
    case 'paragraph': case 'heading': return paragraphXml(node, w);
    case 'bulletList': case 'orderedList': return listXml(node, w, 0);
    case 'blockquote': return (node.content ?? []).map((n) => n.type === 'paragraph' || n.type === 'heading' ? paragraphXml(n, w, { indentExtra: 720 }) : blockXml(n, w)).join('');
    case 'codeBlock': {
      const text = (node.content ?? []).map((n) => n.text ?? '').join('');
      const runs = text.split('\n').map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}${line ? `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/></w:rPr><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>` : ''}`).join('');
      return `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:pPr>${runs}</w:p>`;
    }
    case 'horizontalRule': return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>';
    case 'table': return tableXml(node, w);
    case 'image': return imageXml(node, w);
    default: return paragraphXml({ type: 'paragraph', content: (node.content ?? []).filter((n) => n.type === 'text') }, w);
  }
}

function ensureNamespace(xml: string, prefix: string, uri: string): string {
  const tag = /<w:document\b[^>]*>/.exec(xml); if (!tag || tag[0].includes(`xmlns:${prefix}=`)) return xml;
  return xml.replace(tag[0], tag[0].replace('<w:document', `<w:document xmlns:${prefix}="${uri}"`));
}

/**
 * Patch the original DOCX: every body element whose editor representation is untouched is copied byte-for-byte,
 * only edited or new blocks are regenerated. Headers, footers, styles, numbering and page setup are never rewritten.
 */
export interface ExportOptions {
  /** Write what changed since the original as Word tracked changes (insertions, deletions) instead of silently rewriting it. */
  revisions?: { author?: string; date?: string };
}

function paragraphNodes(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (n: JSONContent): void => { if (n.type === 'paragraph' || n.type === 'heading') out.push(n); else for (const c of n.content ?? []) walk(c); };
  nodes.forEach(walk);
  return out;
}

export async function exportDocxFromOriginal(content: DocumentContent, original: Buffer | Uint8Array, options: ExportOptions = {}): Promise<Uint8Array> {
  const pkg = await loadDocxPackage(original);
  const xml = pkg.documentXml;
  const root = parseXml(xml);
  const doc = child(root, 'w:document'); const body = child(doc, 'w:body');
  if (!doc || !body) throw new Error('原始 Word 文档缺少正文');
  const children = elements(body);
  const sectPr = children.find((c, i) => c.name === 'w:sectPr' && i === children.length - 1);
  const known = new Set(content.docx?.groups ?? []);
  const covered = new Set<number>();
  for (const key of known) { const [a, b] = key.split('-').map(Number); for (let i = a; i <= b; i++) covered.add(i); }
  // Elements the editor never represented (bookmarks, unsupported blocks) stay in place after the block that preceded them.
  const orphansAfter = new Map<number, string[]>(); let anchor = -1;
  children.forEach((c, i) => {
    if (c === sectPr) return;
    if (covered.has(i)) { anchor = i; return; }
    orphansAfter.set(anchor, [...(orphansAfter.get(anchor) ?? []), xml.slice(c.start, c.end)]);
  });
  const nodes = (documentSchema.nodeFromJSON(content.doc).toJSON().content ?? []) as JSONContent[];
  const byKey = new Map<string, JSONContent[]>();
  for (const node of nodes) { const key = attrsOf(node).srcKey as string | undefined; if (key && known.has(key)) byKey.set(key, [...(byKey.get(key) ?? []), node]); }
  let revisionId = 900000;
  const stamp: RevisionStamp | undefined = options.revisions ? { author: options.revisions.author ?? 'Reizo', date: options.revisions.date ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z'), next: () => ++revisionId } : undefined;
  const w: Writer = { pkg, rels: [], links: new Map(), media: new Map(), exts: new Set(), counter: 0, docPr: 100000, ...(stamp ? { revise: { stamp, modes: new Map() } } : {}) };
  // Source groups the editor no longer has were deleted: with tracked changes they stay in place, struck through.
  const removed = [...known].filter((key) => !byKey.has(key)).map((key) => ({ key, from: Number(key.split('-')[0]), to: Number(key.split('-')[1]) })).sort((x, y) => x.from - y.from);
  const flushRemoved = (before: number) => {
    while (stamp && removed.length && removed[0].from < before) { const r = removed.shift()!; out.push(deleteParagraphs(xml.slice(children[r.from].start, children[r.to].end), stamp)); flushOrphans(r.to); }
  };
  const out: string[] = []; const emitted = new Set<string>();
  const flushOrphans = (index: number) => { const list = orphansAfter.get(index); if (list) { out.push(...list); orphansAfter.delete(index); } };
  flushOrphans(-1);
  for (const node of nodes) {
    const key = attrsOf(node).srcKey as string | undefined;
    if (!key || !known.has(key)) {
      if (w.revise) for (const p of paragraphNodes([node])) w.revise.modes.set(p, 'inserted');
      out.push(blockXml(node, w)); continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    const group = byKey.get(key) ?? [];
    const [from, to] = key.split('-').map(Number);
    flushRemoved(from);
    const untouched = sourceHash(group) === attrsOf(group[0]).srcHash && group.every((n) => attrsOf(n).srcHash === attrsOf(group[0]).srcHash);
    if (untouched) { out.push(xml.slice(children[from].start, children[to].end)); flushOrphans(to); continue; }
    let prefix = '';
    if (w.revise) {
      const before = originalParagraphs(xml, children.slice(from, to + 1));
      const after = paragraphNodes(group);
      const hasTable = children.slice(from, to + 1).some((c) => c.name === 'w:tbl') || group.some((n) => n.type === 'table');
      if (before.length === after.length) after.forEach((p, i) => { if (before[i].text !== (p.content ?? []).map((n) => n.type === 'hardBreak' ? '\n' : n.text ?? '').join('')) w.revise!.modes.set(p, before[i]); });
      else if (!hasTable) { prefix = deleteParagraphs(xml.slice(children[from].start, children[to].end), w.revise.stamp); for (const p of after) w.revise.modes.set(p, 'inserted'); }
    }
    out.push(prefix + group.map((n) => blockXml(n, w)).join(''));
    flushOrphans(to);
  }
  flushRemoved(Infinity);
  for (const list of orphansAfter.values()) out.push(...list);
  const originalBody = children.filter((c) => c !== sectPr).map((c) => xml.slice(c.start, c.end));
  const noRelChanges = !w.rels.length && !w.media.size;
  if (noRelChanges && out.join('') === originalBody.join('')) return original instanceof Uint8Array ? original : new Uint8Array(original);

  let next = xml.slice(0, body.openEnd) + out.join('') + (sectPr ? xml.slice(sectPr.start, sectPr.end) : '') + xml.slice(body.closeStart);
  if (w.media.size) next = ensureNamespace(ensureNamespace(next, 'wp', 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'), 'r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
  else if (w.rels.length) next = ensureNamespace(next, 'r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
  pkg.zip.file(pkg.documentPath, next, { createFolders: false });
  if (w.rels.length) {
    const relsPath = 'word/_rels/document.xml.rels';
    const existing = await pkg.zip.file(relsPath)?.async('string');
    pkg.zip.file(relsPath, existing ? existing.replace('</Relationships>', `${w.rels.join('')}</Relationships>`) : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${w.rels.join('')}</Relationships>`);
  }
  for (const [path, bytes] of w.media) pkg.zip.file(path, bytes, { createFolders: false });
  if (w.exts.size) {
    const typesPath = '[Content_Types].xml'; let types = await pkg.zip.file(typesPath)?.async('string') ?? '';
    for (const ext of w.exts) if (!new RegExp(`Extension="${ext}"`, 'i').test(types)) types = types.replace(/(<Types\b[^>]*>)/, `$1<Default Extension="${ext}" ContentType="${MIME[ext]}"/>`);
    pkg.zip.file(typesPath, types);
  }
  return pkg.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

