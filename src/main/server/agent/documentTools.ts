import { tool } from 'ai';
import { z } from 'zod';
import { applyDocumentEdit, DOCUMENT_MIME, documentBlocks, documentEditWithinSelection, documentSchema, parseDocumentContent, type DocumentEdit } from '../../../shared/documentContent';
import type { DocumentReference } from '../../../shared/documentReferences';
import type { ArtifactStore } from '../storage/artifactStore';
import type { ArtifactReviewStore } from '../storage/artifactReviewStore';
import { documentEditSchema } from './documentReviewAdapter';
import { documentFromHtml } from './documentIO';
import { takeWithinBudget } from './readBudget';

/** One block longer than this is cut and flagged `truncated`; keeps a single page under the read budget. */
const MAX_BLOCK_TEXT = 5_000;

export function createDocumentTools(options: { sessionId: string; projectId?: string | null; artifacts: ArtifactStore; reviews: ArtifactReviewStore; references?: DocumentReference[]; getReferences?: () => DocumentReference[] }) {
  const { artifacts, reviews, sessionId } = options;
  const references = () => options.getReferences?.() ?? options.references ?? [];
  return {
    read_document: tool({
      description: '读取本会话 Doc 文档；不提供 artifactId 则列出文档。返回稳定 blockId、版本、块内容和选区。输出按大小分页：若 nextOffset 非空，用它作为 offset 继续读取；blockId 精确读取单块。文字范围是 ProseMirror UTF-16 偏移，图片占 1。修改已有文档只能调用 propose_document_edits。',
      inputSchema: z.object({ artifactId: z.string().optional(), blockId: z.string().optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(80).optional() }),
      execute: async ({ artifactId, blockId, offset = 0, limit = 40 }) => {
        if (!artifactId) return { ok: true, documents: (await artifacts.listBySession(sessionId)).filter((a) => a.kind === 'doc').map((a) => ({ artifactId: a.id, name: a.name, version: a.version })) };
        const artifact = await artifacts.get(artifactId);
        if (!artifact || artifact.sessionId !== sessionId || artifact.kind !== 'doc') return { ok: false, error: '未找到本会话文档' };
        const content = parseDocumentContent(artifact.content);
        if (!content) return { ok: false, error: '文档格式无效' };
        const blocks = documentBlocks(content);
        const page = (blockId ? blocks.filter((b) => b.id === blockId) : blocks.slice(offset, offset + limit))
          .map((b) => ({ ...b, text: b.text.slice(0, MAX_BLOCK_TEXT), truncated: b.text.length > MAX_BLOCK_TEXT }));
        const shown = takeWithinBudget(page);
        // Small metadata first, bulky blocks last: a clip can then never drop the version/pending info.
        return { ok: true, artifactId, name: artifact.name, version: artifact.version, selections: references().filter((r) => r.artifactId === artifactId && r.selection).map((r) => ({ ...r.selection, label: r.label })),
          pendingReviews: reviews.list(artifactId).filter((r) => r.changes.some((c) => c.status === 'pending')).map((r) => ({ id: r.id, stale: r.stale, changes: r.changes.length })),
          totalBlocks: blocks.length, returned: shown.length, nextOffset: !blockId && offset + shown.length < blocks.length ? offset + shown.length : null, blocks: shown };
      },
    }),
    generate_document: tool({
      description: '新建可编辑 Doc 文档，提供标题和标准 HTML（标题、段落、列表、表格等）。同名文档也会新建。修改已有文档必须使用 propose_document_edits。',
      inputSchema: z.object({ title: z.string().trim().min(1).max(200), html: z.string().max(500000) }),
      execute: async ({ title, html }) => {
        try {
          const artifact = await artifacts.create({ sessionId, projectId: options.projectId, name: title, kind: 'doc', mimeType: DOCUMENT_MIME, source: 'generated', content: JSON.stringify(documentFromHtml(html)), origin: { surface: 'chat' } });
          return { ok: true, artifactId: artifact.id, name: artifact.name, version: artifact.version };
        } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '创建失败' }; }
      },
    }),
    propose_document_edits: tool({
      description: '为已有文档创建待审核修改，绝不直接改原文。消息里已带当前文档内容时直接使用其中的 version 和 blockId；否则先 read_document，使用其 version 和 blockId。优先用 replaceText 做最小范围的文字修改（会保留字体、颜色、对齐等原有格式，系统会自动按词拆成多处便于逐项审核）；replaceBlock 会重写整块，仅在必须改结构时使用。每项修改可带一句 reason（≤300 字）说明为什么这样改，审核时会显示在修改旁。选段引用只允许范围内 replaceText；跨段落的选区（带 tail）还允许改写或删除被完整覆盖的段落、在被覆盖段落之后插入。用户在 Doc 面板接受或拒绝，工具不能代替用户接受。',
      inputSchema: z.object({ artifactId: z.string(), expectedVersion: z.number().int().positive(), operations: z.array(documentEditSchema).min(1).max(40) }),
      execute: async ({ artifactId, expectedVersion, operations }) => {
        try {
          const artifact = await artifacts.get(artifactId);
          if (!artifact || artifact.sessionId !== sessionId || artifact.kind !== 'doc') return { ok: false, error: '未找到本会话文档' };
          const selectedRefs = references().filter((r) => r.artifactId === artifactId && r.selection);
          const content = parseDocumentContent(artifact.content);
          if (!content) throw new Error('文档格式无效');
          const pmDoc = documentSchema.nodeFromJSON(content.doc);
          if (selectedRefs.some((ref) => ref.version !== undefined && ref.version !== artifact.version)) throw new Error('选区对应的文档版本已变化，请用户重新选择');
          // Several picked ranges: each operation must land inside one of them.
          if (selectedRefs.length) for (const operation of operations as DocumentEdit[]) applyDocumentEdit(content, operation, (selectedRefs.find((ref) => documentEditWithinSelection(operation, ref.selection!, pmDoc)) ?? selectedRefs[0]).selection);
          const review = await reviews.create({ artifactId, sessionId, expectedVersion, operations, origin: { surface: 'chat' } });
          return { ok: true, artifactId, reviewId: review.id, pending: review.changes.length, summary: '修改建议已显示在 Doc 面板，原文保持不变，等待用户审核。' };
        } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '创建建议失败' }; }
      },
    }),
  };
}
