import { documentBlocks, parseDocumentContent, type DocumentEdit } from '../../../shared/documentContent';
import type { ArtifactReview } from '../../../shared/artifactReview';
import { ArtifactReviewError, type ArtifactReviewStore } from '../storage/artifactReviewStore';

/** Asks a model for one piece of text: (system, prompt) -> the reply. */
export type RewriteText = (system: string, prompt: string, signal?: AbortSignal) => Promise<string>;

const SYSTEM = [
  '你是文档修改助手。用户不满意你上一次对某一段的改写，请按他的反馈重写这一段。',
  '只输出重写后的整段文字本身：不要解释，不要加引号、编号或 Markdown 标记。',
  '保持原文的语言和事实，不要添加原文没有的信息，除非反馈明确要求。',
].join('\n');

export const MAX_FEEDBACK_CHARS = 300;

/** What the model sees: the original paragraph, the rewrite that was not liked, and the user's feedback. */
export function regeneratePrompt(input: { original: string; proposed: string; feedback: string }): string {
  return [`原文段落：\n${input.original}`, `你上一次的改写：\n${input.proposed}`, `用户的反馈：${input.feedback}`, '请给出重写后的整段文字：'].join('\n\n');
}

const clean = (text: string): string => text.trim().replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').replace(/^["“「]/, '').replace(/["”」]$/, '').trim();

/** Apply replaceText hunks that all sit in one block to that block's text. */
function applyHunks(text: string, hunks: { start: number; end: number; text: string }[]): string {
  let out = text;
  for (const hunk of [...hunks].sort((a, b) => b.start - a.start)) out = out.slice(0, hunk.start) + hunk.text + out.slice(hunk.end);
  return out;
}

/**
 * Rewrite one suggestion again from the user's feedback. The suggestion is really a paragraph rewrite that review
 * split into word-level hunks; all hunks of that paragraph are replaced by a fresh rewrite of the whole paragraph.
 */
export async function regenerateDocumentChange(reviews: ArtifactReviewStore, rewrite: RewriteText, input: {
  review: ArtifactReview; changeId: string; feedback: string; signal?: AbortSignal;
}): Promise<ArtifactReview> {
  const { review, changeId, signal } = input;
  const feedback = input.feedback.trim().slice(0, MAX_FEEDBACK_CHARS);
  if (!feedback) throw new ArtifactReviewError('请说明想怎么改');
  if (review.stale) throw new ArtifactReviewError('原文已更新，请先刷新', 409);
  const target = review.changes.find((c) => c.id === changeId);
  if (!target || target.status !== 'pending') throw new ArtifactReviewError('这条建议已处理', 409);
  const operation = target.operation as DocumentEdit;
  if (operation.op !== 'replaceText') throw new ArtifactReviewError('这类修改暂不支持重写，可以拒绝后重新提出');
  const content = parseDocumentContent(review.baseContent);
  const block = content ? documentBlocks(content).find((b) => b.id === operation.blockId) : undefined;
  if (!block) throw new ArtifactReviewError('找不到这一段，请刷新后重试', 409);
  if (block.text.includes('￼')) throw new ArtifactReviewError('这一段含有图片等特殊内容，暂不支持重写');
  const group = review.changes.filter((c) => c.status === 'pending' && (c.operation as DocumentEdit).op === 'replaceText' && (c.operation as { blockId: string }).blockId === operation.blockId);
  const proposed = applyHunks(block.text, group.map((c) => c.operation as { start: number; end: number; text: string }));
  const reply = clean(await rewrite(SYSTEM, regeneratePrompt({ original: block.text, proposed, feedback }), signal));
  if (!reply) throw new ArtifactReviewError('没有得到新的改写，请换个说法再试');
  if (reply === block.text) throw new ArtifactReviewError('新的改写与原文相同');
  if (reply.length > Math.max(2000, block.text.length * 4)) throw new ArtifactReviewError('新的改写过长，请换个说法再试');
  return reviews.replaceChanges({
    id: review.id, sessionId: review.sessionId, expectedReviewVersion: review.reviewVersion, removeIds: group.map((c) => c.id),
    operations: [{ op: 'replaceText', blockId: operation.blockId, start: 0, end: block.inlineSize, text: reply, reason: `按你的反馈重写：${feedback}`.slice(0, 300) }],
  });
}
