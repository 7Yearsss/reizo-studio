import { z } from 'zod';
import { applyDocumentEdit, createDocumentContent, documentBlocks, documentEditTarget, parseDocumentContent, type DocumentContent, type DocumentEdit } from '../../../shared/documentContent';
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

export const documentReviewAdapter: ArtifactReviewAdapter = {
  prepare(_content, operations) {
    return operations.map((operation) => {
      const edit = documentEditSchema.parse(operation) as DocumentEdit;
      if (edit.op === 'insertBlocks') return { ...edit, nodes: createDocumentContent({ type: 'doc', content: edit.nodes.map(freshIds) }).doc.content };
      if (edit.op === 'replaceBlock') return { ...edit, node: createDocumentContent({ type: 'doc', content: [freshIds(edit.node)] }).doc.content?.[0] };
      return edit;
    });
  },
  apply(content, operations) {
    let next = read(content);
    for (const operation of operations) next = applyDocumentEdit(next, documentEditSchema.parse(operation) as DocumentEdit);
    return JSON.stringify(next);
  },
  describe(content, operation) {
    const base = read(content);
    const edit = documentEditSchema.parse(operation) as DocumentEdit;
    const target = documentEditTarget(edit);
    const before = documentBlocks(base).find((b) => b.id === target);
    const after = documentBlocks(applyDocumentEdit(base, edit)).find((b) => b.id === target);
    return {
      label: edit.op === 'insertBlocks' ? '插入文档块' : edit.op === 'deleteBlock' ? '删除文档块' : edit.op === 'replaceText' ? '改写文字' : '修改文档块',
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
      if (targets.has(id)) throw new Error('同一文档块的修改请合并为一项建议');
      targets.add(id);
      const block = blocks.find((b) => b.id === id);
      if (id && !block) throw new Error('目标文档块已变化，请重新读取');
      const from = edit.op === 'insertBlocks' ? (block ? block.pos + block.size : 0) : (block?.pos ?? 0);
      const to = edit.op === 'insertBlocks' ? from : from + (block?.size ?? 0);
      if (ranges.some((range) => from < range.to && range.from < to)) throw new Error('修改范围重叠，请合并到同一文档块');
      ranges.push({ from, to });
    }
  },
};
