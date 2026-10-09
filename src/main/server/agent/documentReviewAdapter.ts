import { z } from 'zod';
import { applyDocumentEdit, createDocumentContent, documentBlocks, documentEditTarget, orderDocumentEdits, parseDocumentContent, type DocumentContent, type DocumentEdit } from '../../../shared/documentContent';
import { diffHunks } from '../../../shared/textDiff';
import type { ArtifactReviewAdapter } from '../storage/artifactReviewStore';
import type { JSONContent } from '@tiptap/core';

function freshIds(node: JSONContent): JSONContent {
  const attrs = { ...node.attrs }; delete attrs.id;
  return { ...node, attrs, ...(node.content ? { content: node.content.map(freshIds) } : {}) };
}

export const documentEditSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('replaceText'), blockId: z.string().min(1), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), text: z.string().max(100000) }),
  z.object({ op: z.literal('replaceBlock'), blockId: z.string().min(1), node: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal('insertBlocks'), afterId: z.string().nullable(), nodes: z.array(z.record(z.string(), z.unknown())).min(1).max(50) }),
  z.object({ op: z.literal('deleteBlock'), blockId: z.string().min(1) }),
]);

function read(content: string): DocumentContent {
  const parsed = parseDocumentContent(content);
  if (!parsed) throw new Error('文档内容无法解析');
  return parsed;
}

const clip = (text: string, max = 24) => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length > max ? `${flat.slice(0, max)}…` : flat; };

export const documentReviewAdapter: ArtifactReviewAdapter = {
  prepare(content, operations) {
    const blocks = documentBlocks(read(content));
    return operations.flatMap((operation): unknown[] => {
      const edit = documentEditSchema.parse(operation) as DocumentEdit;
      if (edit.op === 'insertBlocks') return [{ ...edit, nodes: createDocumentContent({ type: 'doc', content: edit.nodes.map(freshIds) }).doc.content }];
      if (edit.op === 'replaceBlock') return [{ ...edit, node: createDocumentContent({ type: 'doc', content: [freshIds(edit.node)] }).doc.content?.[0] }];
      if (edit.op !== 'replaceText') return [edit];
      // Narrow a rewrite to the words that really changed so review shows exact edits, not whole sentences.
      const block = blocks.find((b) => b.id === edit.blockId);
      if (!block || edit.end > block.text.length) return [edit];
      return diffHunks(block.text.slice(edit.start, edit.end), edit.text).map((hunk) => ({ ...edit, start: edit.start + hunk.start, end: edit.start + hunk.end, text: hunk.text }));
    });
  },
  apply(content, operations) {
    let next = read(content);
    for (const operation of orderDocumentEdits(operations.map((o) => documentEditSchema.parse(o) as DocumentEdit))) next = applyDocumentEdit(next, operation);
    return JSON.stringify(next);
  },
  describe(content, operation) {
    const base = read(content);
    const edit = documentEditSchema.parse(operation) as DocumentEdit;
    const target = documentEditTarget(edit);
    const before = documentBlocks(base).find((b) => b.id === target);
    const after = documentBlocks(applyDocumentEdit(base, edit)).find((b) => b.id === target);
    let label = edit.op === 'insertBlocks' ? '插入内容' : edit.op === 'deleteBlock' ? `删除「${clip(before?.text ?? '')}」` : '修改内容';
    if (edit.op === 'replaceText') {
      const old = (before?.text ?? '').slice(edit.start, edit.end);
      label = !old ? `插入「${clip(edit.text)}」` : !edit.text ? `删除「${clip(old)}」` : `「${clip(old)}」→「${clip(edit.text)}」`;
    } else if (edit.op === 'replaceBlock') label = before && after && before.text === after.text ? '调整格式' : `改写「${clip(before?.text ?? '')}」`;
    return {
      label,
      before: edit.op === 'insertBlocks' ? '' : (before?.text ?? '').slice(0, 4000),
      after: edit.op === 'insertBlocks' ? edit.nodes.map((node) => JSON.stringify(node)).join('\n').slice(0, 4000) : (after?.text ?? '').slice(0, 4000),
    };
  },
  validateBatch(content, operations) {
    const blocks = documentBlocks(read(content));
    const targets = new Set<string | null>();
    const ranges: { from: number; to: number }[] = [];
    for (const operation of operations) {
      const edit = documentEditSchema.parse(operation) as DocumentEdit;
      const id = documentEditTarget(edit);
      const block = blocks.find((b) => b.id === id);
      if (id && !block) throw new Error('目标文档块已变化，请重新读取');
      // Several text edits may share a block as long as they do not overlap; every other op owns its target.
      if (edit.op !== 'replaceText') { if (targets.has(id)) throw new Error('同一文档块的修改请合并为一项建议'); targets.add(id); }
      const from = edit.op === 'insertBlocks' ? (block ? block.pos + block.size : 0) : edit.op === 'replaceText' ? (block?.pos ?? 0) + 1 + edit.start : (block?.pos ?? 0);
      const to = edit.op === 'insertBlocks' ? from : edit.op === 'replaceText' ? (block?.pos ?? 0) + 1 + edit.end : from + (block?.size ?? 0);
      if (ranges.some((range) => (from < range.to && range.from < to) || (from === to && range.from === range.to && from === range.from))) throw new Error('修改范围重叠，请合并到同一文档块');
      ranges.push({ from, to });
    }
  },
  /** After some changes are accepted, text offsets of later changes in the same block move with them. */
  rebase(accepted, operation) {
    const edit = documentEditSchema.parse(operation) as DocumentEdit;
    if (edit.op !== 'replaceText') return operation;
    let delta = 0;
    for (const item of accepted) {
      const other = documentEditSchema.parse(item) as DocumentEdit;
      if (other.op === 'replaceText' && other.blockId === edit.blockId && other.end <= edit.start) delta += other.text.length - (other.end - other.start);
    }
    return delta ? { ...edit, start: edit.start + delta, end: edit.end + delta } : operation;
  },
};
