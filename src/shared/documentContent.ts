import { getSchema, type JSONContent, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import UniqueID, { generateUniqueIds } from '@tiptap/extension-unique-id';
import { type Node as DocumentNode } from '@tiptap/pm/model';
import { EditorState, type Transaction } from '@tiptap/pm/state';

export const DOCUMENT_MIME = 'application/vnd.reizo.document+json';
export const MAX_DOCUMENT_BYTES = 3_500_000;

export interface DocumentContent {
  schemaVersion: 1;
  doc: JSONContent;
  originalArtifactId?: string;
  importWarnings?: string[];
}

export interface DocumentSelection { blockId: string; start: number; end: number; text?: string }
export type DocumentEdit =
  | { op: 'replaceText'; blockId: string; start: number; end: number; text: string }
  | { op: 'replaceBlock'; blockId: string; node: JSONContent }
  | { op: 'insertBlocks'; afterId: string | null; nodes: JSONContent[] }
  | { op: 'deleteBlock'; blockId: string };

export function documentExtensions(): Extensions {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({ allowBase64: true }),
    UniqueID.configure({ types: 'all' }),
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

export function normalizeDocumentContent(value: unknown): DocumentContent {
  if (!value || typeof value !== 'object') throw new Error('文档内容无效');
  const content = value as DocumentContent;
  if (content.schemaVersion !== 1 || content.doc?.type !== 'doc') throw new Error('文档格式不受支持');
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_DOCUMENT_BYTES) throw new Error('文档内容过大');
  const node = documentSchema.nodeFromJSON(content.doc);
  node.check();
  validateAttributes(node);
  const doc = generateUniqueIds(node.toJSON(), documentExtensions());
  return { schemaVersion: 1, doc, ...(typeof content.originalArtifactId === 'string' ? { originalArtifactId: content.originalArtifactId } : {}), ...(Array.isArray(content.importWarnings) ? { importWarnings: content.importWarnings.filter((v) => typeof v === 'string').slice(0, 20) } : {}) };
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
  const replacement = state.schema.nodeFromJSON({ ...edit.node, attrs: { ...edit.node.attrs, id: target.node.attrs.id } });
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
