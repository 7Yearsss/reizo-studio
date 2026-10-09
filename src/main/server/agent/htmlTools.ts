import { tool } from 'ai';
import { z } from 'zod';
import { applyHtmlEdits, htmlEditRange, validateHtmlContent, type HtmlEdit } from '../../../shared/htmlContent';
import type { HtmlReference } from '../../../shared/htmlReferences';
import type { ArtifactStore } from '../storage/artifactStore';
import type { ArtifactReviewAdapter, ArtifactReviewStore } from '../storage/artifactReviewStore';

const editSchema = z.object({ oldText: z.string().min(1).max(500000), newText: z.string().max(500000) });
export const htmlReviewAdapter: ArtifactReviewAdapter = {
  apply(content, operations) { return applyHtmlEdits(content, operations.map((op) => editSchema.parse(op))); },
  describe(content, operation) {
    const edit = editSchema.parse(operation); const range = htmlEditRange(content, edit);
    return { label: `修改源码 · 第 ${content.slice(0, range.start).split('\n').length} 行`, before: edit.oldText, after: edit.newText };
  },
  validateBatch(content, operations) { applyHtmlEdits(content, operations as HtmlEdit[]); },
};

export function createHtmlTools(options: { sessionId: string; projectId?: string | null; artifacts: ArtifactStore; reviews: ArtifactReviewStore; getReferences?: () => HtmlReference[] }) {
  const { sessionId, artifacts, reviews } = options;
  return {
    read_html: tool({
      description: '列出或读取本会话 HTML 页面最新源码。startLine 从 1 开始，最多 200 行/24000 字符；返回 version 供修改校验。先读取再提出建议。',
      inputSchema: z.object({ artifactId: z.string().optional(), startLine: z.number().int().positive().optional(), limit: z.number().int().min(1).max(200).optional() }),
      execute: async ({ artifactId, startLine = 1, limit = 120 }) => {
        if (!artifactId) return { ok: true, pages: (await artifacts.listBySession(sessionId)).filter((a) => a.kind === 'html').map((a) => ({ artifactId: a.id, name: a.name, version: a.version })) };
        const artifact = await artifacts.get(artifactId);
        if (!artifact || artifact.sessionId !== sessionId || artifact.kind !== 'html') return { ok: false, error: '未找到本会话 HTML 页面' };
        const lines = artifact.content.split('\n'); const text = lines.slice(startLine - 1, startLine - 1 + limit).join('\n');
        return { ok: true, artifactId, name: artifact.name, version: artifact.version, startLine, totalLines: lines.length, text: text.slice(0, 24000), truncated: text.length > 24000 || startLine + limit - 1 < lines.length, selection: options.getReferences?.().find((ref) => ref.artifactId === artifactId)?.selection };
      },
    }),
    generate_html: tool({
      description: '新建独立可编辑 HTML 页面，支持内联 CSS 和 JavaScript。同名页面也新建；修改已有页面必须使用 propose_html_edits。',
      inputSchema: z.object({ title: z.string().trim().min(1).max(200), html: z.string().max(1000000) }),
      execute: async ({ title, html }) => {
        try {
          const artifact = await artifacts.create({ sessionId, projectId: options.projectId, name: /\.html?$/i.test(title) ? title : `${title}.html`, kind: 'html', content: validateHtmlContent(html), source: 'generated', origin: { surface: 'chat' } });
          return { ok: true, artifactId: artifact.id, name: artifact.name, version: artifact.version };
        } catch (error) { return { ok: false, error: String(error) }; }
      },
    }),
    propose_html_edits: tool({
      description: '提交 HTML 修改建议，原始源码不变。传入最新 expectedVersion 和精确唯一匹配的 oldText/newText。每项修改独立且不重叠，选区引用限制修改范围。用户通过源码 diff 和预览审核。',
      inputSchema: z.object({ artifactId: z.string(), expectedVersion: z.number().int().positive(), edits: z.array(editSchema).min(1).max(40) }),
      execute: async ({ artifactId, expectedVersion, edits }) => {
        try {
          const artifact = await artifacts.get(artifactId);
          if (!artifact || artifact.sessionId !== sessionId || artifact.kind !== 'html') return { ok: false, error: '未找到本会话 HTML 页面' };
          for (const ref of options.getReferences?.().filter((ref) => ref.artifactId === artifactId && ref.selection) ?? []) {
            if (ref.version !== artifact.version) throw new Error('引用的源码版本已变化，请重新选择');
            applyHtmlEdits(artifact.content, edits, ref.selection);
          }
          const review = await reviews.create({ artifactId, sessionId, expectedVersion, operations: edits, origin: { surface: 'chat' } });
          return { ok: true, artifactId, reviewId: review.id, pending: review.changes.length, summary: 'HTML 修改建议已生成，请用户查看差异并接受或拒绝。' };
        } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '创建建议失败' }; }
      },
    }),
  };
}
