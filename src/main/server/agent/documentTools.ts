import { tool } from 'ai';
import { z } from 'zod';
import { applyDocumentEdit, DOCUMENT_MIME, documentBlocks, parseDocumentContent, type DocumentEdit } from '../../../shared/documentContent';
import type { DocumentReference } from '../../../shared/documentReferences';
import type { ArtifactStore } from '../storage/artifactStore';
import type { ArtifactReviewStore } from '../storage/artifactReviewStore';
import { documentEditSchema } from './documentReviewAdapter';
import { documentFromHtml } from './documentIO';

export function createDocumentTools(options: { sessionId: string; projectId?: string | null; artifacts: ArtifactStore; reviews: ArtifactReviewStore; references?: DocumentReference[]; getReferences?: () => DocumentReference[] }) {
  const { artifacts, reviews, sessionId } = options;
  const references = () => options.getReferences?.() ?? options.references ?? [];
  return {
    read_document: tool({
      description: '读取本会话 Doc 文档；不提供 artifactId 则列出文档。返回稳定 blockId、版本、块内容和选区。使用 offset/limit 分页，blockId 精确读取。文字范围是 ProseMirror UTF-16 偏移，图片占 1。修改已有文档只能调用 propose_document_edits。',
      inputSchema: z.object({ artifactId: z.string().optional(), blockId: z.string().optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(80).optional() }),
      execute: async ({ artifactId, blockId, offset = 0, limit = 40 }) => {
        if (!artifactId) return { ok: true, documents: (await artifacts.listBySession(sessionId)).filter((a) => a.kind === 'doc').map((a) => ({ artifactId: a.id, name: a.name, version: a.version })) };
        const artifact = await artifacts.get(artifactId);
        if (!artifact || artifact.sessionId !== sessionId || artifact.kind !== 'doc') return { ok: false, error: '未找到本会话文档' };
        const content = parseDocumentContent(artifact.content);
        if (!content) return { ok: false, error: '文档格式无效' };
        const blocks = documentBlocks(content);
        return { ok: true, artifactId, name: artifact.name, version: artifact.version, selection: references().find((r) => r.artifactId === artifactId)?.selection,
          totalBlocks: blocks.length, blocks: (blockId ? blocks.filter((b) => b.id === blockId) : blocks.slice(offset, offset + limit)).map((b) => ({ ...b, text: b.text.slice(0, 12000), truncated: b.text.length > 12000 })),
          pendingReviews: reviews.list(artifactId).filter((r) => r.changes.some((c) => c.status === 'pending')).map((r) => ({ id: r.id, stale: r.stale, changes: r.changes.length })) };
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
      description: '为已有文档创建待审核修改，绝不直接改原文。先 read_document，使用其 version 和 blockId。优先用 replaceText 做最小范围的文字修改（会保留字体、颜色、对齐等原有格式，系统会自动按词拆成多处便于逐项审核）；replaceBlock 会重写整块，仅在必须改结构时使用。选段引用只允许范围内 replaceText。用户在 Doc 面板接受或拒绝，工具不能代替用户接受。',
      inputSchema: z.object({ artifactId: z.string(), expectedVersion: z.number().int().positive(), operations: z.array(documentEditSchema).min(1).max(40) }),
      execute: async ({ artifactId, expectedVersion, operations }) => {
        try {
          const artifact = await artifacts.get(artifactId);
          if (!artifact || artifact.sessionId !== sessionId || artifact.kind !== 'doc') return { ok: false, error: '未找到本会话文档' };
          const selectedRefs = references().filter((r) => r.artifactId === artifactId && r.selection);
          const content = parseDocumentContent(artifact.content);
          if (!content) throw new Error('文档格式无效');
          for (const ref of selectedRefs) {
            if (ref.version !== undefined && ref.version !== artifact.version) throw new Error('选区对应的文档版本已变化，请用户重新选择');
            for (const operation of operations) applyDocumentEdit(content, operation as DocumentEdit, ref.selection);
          }
          const review = await reviews.create({ artifactId, sessionId, expectedVersion, operations, origin: { surface: 'chat' } });
          return { ok: true, artifactId, reviewId: review.id, pending: review.changes.length, summary: '修改建议已显示在 Doc 面板，原文保持不变，等待用户审核。' };
        } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '创建建议失败' }; }
      },
    }),
  };
}
