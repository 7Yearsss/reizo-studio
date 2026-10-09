import { getSchema, Extension, Mark, type JSONContent, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import UniqueID, { generateUniqueIds } from '@tiptap/extension-unique-id';
import { type Node as DocumentNode } from '@tiptap/pm/model';
import { EditorState, type Transaction } from '@tiptap/pm/state';

export const DOCUMENT_MIME = 'application/vnd.reizo.document+json';
export const MAX_DOCUMENT_BYTES = 3_500_000;

/** Default typography of an imported Word file; runs equal to it carry no explicit style. */
export interface DocumentTypography { fontFamily?: string; fontSize?: number; lineHeight?: number }
/** Bookkeeping that lets export reuse untouched source XML from the original DOCX. */
export interface DocxSourceInfo { groups: string[]; typography?: DocumentTypography }
export interface DocumentContent {
  schemaVersion: 1;
  doc: JSONContent;
  originalArtifactId?: string;
  importWarnings?: string[];
  docx?: DocxSourceInfo;
}

export interface DocumentSelection { blockId: string; start: number; end: number; text?: string }
export type DocumentEdit = (
  | { op: 'replaceText'; blockId: string; start: number; end: number; text: string }
  | { op: 'replaceBlock'; blockId: string; node: JSONContent }
  | { op: 'insertBlocks'; afterId: string | null; nodes: JSONContent[] }
  | { op: 'deleteBlock'; blockId: string }
) & { reason?: string };

const TOP_LEVEL_TYPES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'image'];
/** Attributes that carry source formatting; carried over when AI replaces a block. */
export const FIDELITY_BLOCK_ATTRS = ['textAlign', 'indentLeft', 'indentFirst', 'spaceBefore', 'spaceAfter', 'lineSpacing', 'pStyle', 'pPrExtra', 'srcKey', 'srcHash', 'numId', 'tblPr'] as const;

export function safeHex(value: unknown): string | null { const v = String(value ?? '').replace(/^#/, ''); return /^[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null; }
export function safeFont(value: unknown): string | null {
  const v = String(value ?? '').replace(/["';{}\\]/g, '').trim();
  return v && v.length <= 120 && /^[\p{L}\p{N} ,._-]+$/u.test(v) ? v : null;
}
function safeNumber(value: unknown, min: number, max: number): number | null { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) && n >= min && n <= max ? n : null; }
function cssFontStack(font: string): string { return font.split(',').map((name) => `"${name.trim()}"`).join(', '); }
function rgbToHex(value: string): string | null {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value.trim());
  return m ? [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('') : safeHex(value);
}
const twipsToPt = (twips: unknown, min = -20000, max = 20000) => { const n = safeNumber(twips, min, max); return n === null ? null : n / 20; };
const ALIGNS = ['left', 'center', 'right', 'justify'];
const blockAttr = (name: string, extra: Record<string, unknown> = {}): Record<string, Record<string, unknown>> => ({ [name]: { default: null, rendered: false, ...extra } });
type Attrs = Record<string, unknown>;

/** Word-fidelity attributes: paragraph layout and source mapping. Pure data, no behaviour. */
const DocxFidelity = Extension.create({
  name: 'docxFidelity',
  addGlobalAttributes() {
    return [
      { types: ['paragraph', 'heading'], attributes: {
        textAlign: { default: null, parseHTML: (el: HTMLElement) => ALIGNS.includes(el.style.textAlign) ? el.style.textAlign : null, renderHTML: (a: Attrs) => ALIGNS.includes(String(a.textAlign)) ? { style: `text-align:${a.textAlign}` } : {} },
        indentLeft: { default: null, renderHTML: (a: Attrs) => { const pt = twipsToPt(a.indentLeft); return pt === null ? {} : { style: `margin-left:${pt}pt` }; } },
        indentFirst: { default: null, renderHTML: (a: Attrs) => { const pt = twipsToPt(a.indentFirst); return pt === null ? {} : { style: `text-indent:${pt}pt` }; } },
        spaceBefore: { default: null, renderHTML: (a: Attrs) => { const pt = twipsToPt(a.spaceBefore, 0); return pt === null ? {} : { style: `margin-top:${pt}pt` }; } },
        spaceAfter: { default: null, renderHTML: (a: Attrs) => { const pt = twipsToPt(a.spaceAfter, 0); return pt === null ? {} : { style: `margin-bottom:${pt}pt` }; } },
        lineSpacing: { default: null, renderHTML: (a: Attrs) => { const n = safeNumber(a.lineSpacing, 0.5, 5); return n === null ? {} : { style: `line-height:${n}` }; } },
        ...blockAttr('pStyle'), ...blockAttr('pPrExtra'),
      } },
      { types: TOP_LEVEL_TYPES, attributes: { ...blockAttr('srcKey', { keepOnSplit: false }), ...blockAttr('srcHash', { keepOnSplit: false }) } },
      { types: ['bulletList', 'orderedList'], attributes: { ...blockAttr('numId') } },
      { types: ['table'], attributes: { ...blockAttr('tblPr') } },
      { types: ['tableCell', 'tableHeader'], attributes: {
        background: { default: null, parseHTML: (el: HTMLElement) => rgbToHex(el.style.backgroundColor || ''), renderHTML: (a: Attrs) => { const hex = safeHex(a.background); return hex ? { style: `background-color:#${hex}` } : {}; } },
      } },
    ];
  },
});

/** Run-level style (colour, size in pt, font, highlight, super/subscript) preserved from Word. */
const RunStyle = Mark.create({
  name: 'runStyle',
  addAttributes() { return { color: { default: null, rendered: false }, size: { default: null, rendered: false }, font: { default: null, rendered: false }, highlight: { default: null, rendered: false }, vert: { default: null, rendered: false } }; },
  parseHTML() {
    return [{ tag: 'span[style]', getAttrs: (el) => {
      const style = (el as HTMLElement).style;
      const size = /^([\d.]+)(pt|px)$/.exec(style.fontSize || '');
      const attrs = {
        color: style.color ? rgbToHex(style.color) : null,
        highlight: style.backgroundColor ? rgbToHex(style.backgroundColor) : null,
        font: style.fontFamily ? safeFont(style.fontFamily.split(',').map((f) => f.replace(/["']/g, '').trim()).filter(Boolean).join(',')) : null,
        size: size ? (size[2] === 'pt' ? Number(size[1]) : Math.round(Number(size[1]) * 0.75 * 2) / 2) : null,
        vert: null as string | null,
      };
      return Object.values(attrs).some((v) => v !== null) ? attrs : false;
    } }];
  },
  renderHTML({ mark }) {
    const a = mark.attrs as Attrs; const style: string[] = [];
    const color = safeHex(a.color); if (color) style.push(`color:#${color}`);
    const highlight = safeHex(a.highlight); if (highlight) style.push(`background-color:#${highlight}`);
    const size = safeNumber(a.size, 1, 400); if (size) style.push(`font-size:${size}pt`);
    const font = safeFont(a.font); if (font) style.push(`font-family:${cssFontStack(font)}`);
    if (a.vert === 'superscript') style.push('vertical-align:super', 'font-size:smaller'); else if (a.vert === 'subscript') style.push('vertical-align:sub', 'font-size:smaller');
    return ['span', style.length ? { style: style.join(';') } : {}, 0];
  },
});

export function documentExtensions(): Extensions {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({ allowBase64: true }),
    UniqueID.configure({ types: 'all' }),
    DocxFidelity,
    RunStyle,
  ];
}

export const documentSchema = getSchema(documentExtensions());
function validateAttributes(doc: DocumentNode): void {
  let count = 0;
  doc.descendants((node) => {
    if (++count > 20_000) throw new Error('文档节点过多，请拆分文档');
    if (node.type.name === 'image') {
      const src = String(node.attrs.src ?? '');
      if (!/^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(src)) throw new Error('图片必须使用 HTTP(S) 地址或内嵌图片');
    }
    for (const mark of node.marks) if (mark.type.name === 'link' && !/^(https?:\/\/|mailto:|tel:|#)/i.test(String(mark.attrs.href ?? ''))) throw new Error('链接地址不受支持');
  });
}

function normalizeDocxInfo(value: unknown): DocxSourceInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const info = value as DocxSourceInfo;
  if (!Array.isArray(info.groups)) return undefined;
  const groups = info.groups.filter((g) => typeof g === 'string' && /^\d+-\d+$/.test(g)).slice(0, 50_000);
  const t = info.typography; const typography: DocumentTypography = {};
  if (t && typeof t === 'object') {
    const font = safeFont(t.fontFamily); if (font) typography.fontFamily = font;
    const size = safeNumber(t.fontSize, 1, 400); if (size) typography.fontSize = size;
    const line = safeNumber(t.lineHeight, 0.5, 5); if (line) typography.lineHeight = line;
  }
  return { groups, ...(Object.keys(typography).length ? { typography } : {}) };
}
/** Inline CSS for the editing surface so imported text without explicit style looks like the Word default. */
export function typographyCss(content: DocumentContent | null | undefined): string {
  const t = content?.docx?.typography; const style: string[] = [];
  if (t?.fontFamily) style.push(`font-family:${cssFontStack(t.fontFamily)}`);
  if (t?.fontSize) style.push(`font-size:${t.fontSize}pt`);
  if (t?.lineHeight) style.push(`line-height:${t.lineHeight}`);
  return style.join(';');
}

export function normalizeDocumentContent(value: unknown): DocumentContent {
  if (!value || typeof value !== 'object') throw new Error('文档内容无效');
  const content = value as DocumentContent;
  if (content.schemaVersion !== 1 || content.doc?.type !== 'doc') throw new Error('文档格式不受支持');
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_DOCUMENT_BYTES) throw new Error('文档内容过大');
  const node = documentSchema.nodeFromJSON(content.doc);
  node.check();
  validateAttributes(node);
  const doc = generateUniqueIds(node.toJSON(), documentExtensions());
  const docx = normalizeDocxInfo(content.docx);
  return { schemaVersion: 1, doc, ...(typeof content.originalArtifactId === 'string' ? { originalArtifactId: content.originalArtifactId } : {}), ...(Array.isArray(content.importWarnings) ? { importWarnings: content.importWarnings.filter((v) => typeof v === 'string').slice(0, 20) } : {}), ...(docx ? { docx } : {}) };
}

export function parseDocumentContent(raw: string): DocumentContent | null {
  try { return normalizeDocumentContent(JSON.parse(raw)); } catch { return null; }
}

export function createDocumentContent(doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }): DocumentContent {
  return normalizeDocumentContent({ schemaVersion: 1, doc });
}

export interface DocumentBlock { id: string; type: string; pos: number; size: number; text: string; inlineSize: number }
export function documentBlocks(content: DocumentContent): DocumentBlock[] {
  const doc = documentSchema.nodeFromJSON(content.doc);
  const blocks: DocumentBlock[] = [];
  doc.descendants((node, pos) => {
    if (typeof node.attrs.id !== 'string') return;
    blocks.push({ id: node.attrs.id, type: node.type.name, pos, size: node.nodeSize, text: node.textBetween(0, node.content.size, '\n', '\ufffc'), inlineSize: node.content.size });
  });
  return blocks;
}

function locate(doc: DocumentNode, id: string): { node: DocumentNode; pos: number } {
  let found: { node: DocumentNode; pos: number } | undefined;
  doc.descendants((node, pos) => { if (node.attrs.id === id) found = { node, pos }; });
  if (!found) throw new Error('目标段落已变化，请重新读取文档');
  return found;
}

/** A rewritten block keeps the old block's layout attributes and, when it brings no run style of its own, the old uniform run style. */
function inheritFormatting(base: DocumentNode, next: JSONContent): JSONContent {
  if (next.type !== base.type.name) return next;
  const attrs: Attrs = { ...next.attrs };
  for (const key of FIDELITY_BLOCK_ATTRS) if (attrs[key] == null && base.attrs[key] != null) attrs[key] = base.attrs[key];
  if (!base.isTextblock || !next.content) return { ...next, attrs };
  const styles = new Set<string>(); let sample: Attrs | undefined;
  base.descendants((node) => { for (const mark of node.marks) if (mark.type.name === 'runStyle') { styles.add(JSON.stringify(mark.attrs)); sample = mark.attrs; } });
  const hasOwn = next.content.some((n) => n.marks?.some((m) => m.type === 'runStyle'));
  if (styles.size !== 1 || !sample || hasOwn) return { ...next, attrs };
  const inherited = sample;
  return { ...next, attrs, content: next.content.map((n) => n.type === 'text' ? { ...n, marks: [...(n.marks ?? []), { type: 'runStyle', attrs: inherited }] } : n) };
}

export function editTransaction(state: EditorState, edit: DocumentEdit, selection?: DocumentSelection): Transaction {
  const transaction = state.tr;
  if (selection && (edit.op !== 'replaceText' || edit.blockId !== selection.blockId || edit.start < selection.start || edit.end > selection.end)) throw new Error('修改超出所选内容；请重新选择范围或引用整篇文档');
  if (edit.op === 'insertBlocks') {
    const target = edit.afterId ? locate(state.doc, edit.afterId) : null;
    if (!edit.nodes.length || edit.nodes.length > 50) throw new Error('每次插入 1 至 50 个文档块');
    const nodes = edit.nodes.map((node) => state.schema.nodeFromJSON(node));
    if (nodes.some((node) => node.type.name === 'doc' || node.isInline)) throw new Error('只能插入段落、表格等文档块');
    return transaction.insert(target ? target.pos + target.node.nodeSize : 0, nodes);
  }
  const target = locate(state.doc, edit.blockId);
  if (edit.op === 'replaceText') {
    if (!target.node.isTextblock || !Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end < edit.start || edit.end > target.node.content.size) throw new Error('文字范围无效，请使用 read_document 返回的范围');
    if (edit.text.length > 100_000) throw new Error('单次替换内容过长');
    return transaction.insertText(edit.text, target.pos + 1 + edit.start, target.pos + 1 + edit.end);
  }
  if (edit.op === 'deleteBlock') return transaction.delete(target.pos, target.pos + target.node.nodeSize);
  const replacement = state.schema.nodeFromJSON(inheritFormatting(target.node, { ...edit.node, attrs: { ...edit.node.attrs, id: target.node.attrs.id } }));
  if (replacement.type.name === 'doc' || replacement.isInline) throw new Error('替换内容必须是一个文档块');
  return transaction.replaceWith(target.pos, target.pos + target.node.nodeSize, replacement);
}

export function applyDocumentEdit(content: DocumentContent, edit: DocumentEdit, selection?: DocumentSelection): DocumentContent {
  const state = EditorState.create({ schema: documentSchema, doc: documentSchema.nodeFromJSON(content.doc) });
  const transaction = editTransaction(state, edit, selection);
  transaction.doc.check();
  return normalizeDocumentContent({ ...content, doc: transaction.doc.toJSON() });
}

export function documentEditTarget(edit: DocumentEdit): string | null {
  return edit.op === 'insertBlocks' ? edit.afterId : edit.blockId;
}

/**
 * Apply order for a batch: text edits inside one block run from the end backwards so earlier offsets stay valid
 * whether the edits are projected for review or committed.
 */
export function orderDocumentEdits<T extends DocumentEdit>(edits: T[]): T[] {
  const out: T[] = []; const done = new Set<string>();
  for (const edit of edits) {
    if (edit.op !== 'replaceText') { out.push(edit); continue; }
    if (done.has(edit.blockId)) continue;
    done.add(edit.blockId);
    out.push(...edits.filter((e): e is T & { op: 'replaceText' } => e.op === 'replaceText' && e.blockId === edit.blockId).sort((x, y) => y.start - x.start));
  }
  return out;
}
