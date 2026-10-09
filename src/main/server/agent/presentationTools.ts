import { tool } from 'ai';
import { z } from 'zod';
import { applyPresentationEdit, normalizePresentation, parsePresentation, presentationElements, PRESENTATION_MIME, type PresentationEdit, type PresentationElement, type PresentationReference } from '../../../shared/presentationContent';
import type { ArtifactStore } from '../storage/artifactStore';
import type { ArtifactReviewAdapter, ArtifactReviewStore } from '../storage/artifactReviewStore';
import { takeWithinBudget } from './readBudget';

const layoutSchema = z.record(z.string(), z.unknown());
const slideSchema = z.object({ id: z.string().optional(), title: z.string().max(200), layout: layoutSchema, notes: z.string().max(20000).optional() });
const editSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('updateElement'), slideId: z.string(), elementId: z.string(), patch: layoutSchema }),
  z.object({ op: z.literal('insertElement'), slideId: z.string(), element: layoutSchema }),
  z.object({ op: z.literal('deleteElement'), slideId: z.string(), elementId: z.string() }),
  z.object({ op: z.literal('addSlide'), afterId: z.string().nullable(), slide: slideSchema }),
  z.object({ op: z.literal('deleteSlide'), slideId: z.string() }),
  z.object({ op: z.literal('updateSlide'), slideId: z.string(), title: z.string().max(200).optional(), notes: z.string().max(20000).optional(), background: z.unknown().optional() }),
]);
function read(content: string) { const parsed = parsePresentation(content); if (!parsed) throw new Error('演示稿格式无效'); return parsed; }
function fresh(value: unknown): unknown { if (Array.isArray(value)) return value.map(fresh); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id').map(([key, item]) => [key, fresh(item)])); return value; }
function summary(element: PresentationElement): string {
  return JSON.stringify(element, (key, value) => typeof value === 'string' && value.startsWith('data:image/') ? `[内嵌图片，${value.length} 字符]` : value);
}
export const presentationReviewAdapter: ArtifactReviewAdapter = {
  prepare(_content, operations) {
    return operations.map((operation) => {
      const edit = editSchema.parse(operation) as PresentationEdit;
      if (edit.op === 'addSlide') return { ...edit, slide: normalizePresentation({ schemaVersion: 1, slides: [fresh(edit.slide)] }).slides[0] };
      if (edit.op === 'insertElement') return { ...edit, element: normalizePresentation({ schemaVersion: 1, slides: [{ title: 'Slide', layout: { elements: [fresh(edit.element)] } }] }).slides[0].layout.elements?.[0] };
      return edit;
    });
  },
  apply(content, operations) { let next = read(content); for (const op of operations) next = applyPresentationEdit(next, editSchema.parse(op) as PresentationEdit); return JSON.stringify(next); },
  describe(content, operation) {
    const edit = editSchema.parse(operation) as PresentationEdit; const base = read(content);
    const id = edit.op === 'addSlide' ? edit.slide.id : edit.slideId; const before = base.slides.find((slide) => slide.id === id); const after = applyPresentationEdit(base, edit).slides.find((slide) => slide.id === id);
    const targetId = edit.op === 'updateElement' || edit.op === 'deleteElement' ? edit.elementId : edit.op === 'insertElement' ? edit.element.id : undefined;
    const oldElement = targetId && before ? presentationElements(before).find((e) => e.element.id === targetId)?.element : undefined;
    const nextElement = targetId && after ? presentationElements(after).find((e) => e.element.id === targetId)?.element : undefined;
    return { label: `${before?.title ?? after?.title ?? '页面'} · ${oldElement?.name ?? nextElement?.name ?? (edit.op === 'deleteSlide' ? '删除页面' : edit.op === 'addSlide' ? '添加页面' : '页面属性')}`, before: oldElement ? summary(oldElement) : before && !targetId ? JSON.stringify({ title: before.title, notes: before.notes, background: before.layout.background }) : '', after: nextElement ? summary(nextElement) : after && !targetId ? JSON.stringify({ title: after.title, notes: after.notes, background: after.layout.background }) : '' };
  },
  validateBatch(content, operations) {
    const base = read(content); const touched: { slide: string; id?: string; ancestors: string[]; whole: boolean }[] = [];
    for (const value of operations) {
      const edit = editSchema.parse(value) as PresentationEdit;
      if (edit.op === 'addSlide') continue;
      const slide = base.slides.find((slide) => slide.id === edit.slideId); if (!slide) throw new Error('请先读取现有页面，新页的编辑请放入添加页操作');
      const id = edit.op === 'updateElement' || edit.op === 'deleteElement' ? edit.elementId : edit.op === 'insertElement' ? edit.element.id : undefined;
      const ancestors = presentationElements(slide).find((e) => e.element.id === id)?.ancestors ?? [];
      const whole = edit.op === 'deleteSlide';
      if (touched.some((item) => item.slide === slide.id && (whole || item.whole || (id && (id === item.id || item.ancestors.includes(id) || ancestors.includes(item.id ?? ''))) || (!id && !item.id)))) throw new Error('同一元素或重叠范围的修改请合并为一项建议');
      touched.push({ slide: slide.id, id, ancestors, whole });
    }
  },
};
export function createPresentationTools(options: { sessionId: string; projectId?: string | null; artifacts: ArtifactStore; reviews: ArtifactReviewStore; getReferences?: () => PresentationReference[] }) {
  const { artifacts, reviews, sessionId } = options;
  return {
    read_presentation: tool({ description: '读取本会话 PPT；不传 artifactId 列出演示稿。传 slideId/elementId 精确读取；元素按大小分页，nextOffset 非空时用它作为 offset 继续读取。返回最新 version、稳定页与元素 ID、元素属性。图片返回摘要；geometry 单位是 1280×720 画布像素。', inputSchema: z.object({ artifactId: z.string().optional(), slideId: z.string().optional(), elementId: z.string().optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(40).optional() }),
      execute: async ({ artifactId, slideId, elementId, offset = 0, limit = 20 }) => {
        if (!artifactId) return { ok: true, presentations: (await artifacts.listBySession(sessionId)).filter((a) => a.kind === 'presentation').map((a) => ({ artifactId: a.id, name: a.name, version: a.version })) };
        const artifact = await artifacts.get(artifactId); if (!artifact || artifact.sessionId !== sessionId || artifact.kind !== 'presentation') return { ok: false, error: '未找到本会话演示稿' };
        const deck = read(artifact.content); const slides = slideId ? deck.slides.filter((s) => s.id === slideId) : deck.slides.slice(0, 1);
        return { ok: true, artifactId, name: artifact.name, version: artifact.version, canvas: { width: 1280, height: 720 }, slides: deck.slides.map((s) => ({ id: s.id, title: s.title, elements: presentationElements(s).length })), content: slides.map((s) => {
          const all = presentationElements(s).filter((e) => !elementId || e.element.id === elementId);
          const shown = takeWithinBudget(all.slice(offset, offset + limit).map((e) => ({ id: e.element.id, ancestors: e.ancestors, attributes: summary(e.element).slice(0, 2000) })));
          return { id: s.id, notes: s.notes, background: s.layout.background, totalElements: all.length, nextOffset: offset + shown.length < all.length ? offset + shown.length : null, elements: shown };
        }), scope: options.getReferences?.().find((r) => r.artifactId === artifactId) };
      } }),
    generate_presentation: tool({ description: '新建可编辑 PPT。slides[].layout 使用 Template V2：elements 数组，每元素有 type、position:{x,y}、size:{width,height}；text 用 runs:[{text}]、font:{family,size,color,bold}；image 用 data；rectangle/ellipse 用 fill:{color}；坐标 1280×720。修改已有稿必须提出建议。', inputSchema: z.object({ title: z.string().min(1).max(200), slides: z.array(slideSchema).min(1).max(64) }), execute: async ({ title, slides }) => {
      try { const artifact = await artifacts.create({ sessionId, projectId: options.projectId, name: title, kind: 'presentation', mimeType: PRESENTATION_MIME, source: 'generated', origin: { surface: 'chat' }, content: JSON.stringify(normalizePresentation({ schemaVersion: 1, slides })) }); return { ok: true, artifactId: artifact.id, name: artifact.name, version: artifact.version }; } catch (error) { return { ok: false, error: String(error) }; }
    } }),
    propose_presentation_edits: tool({ description: '为已有 PPT 提出待审核的页面/元素修改。先读取最新 version 和 ID，使用 expectedVersion。patch 是元素顶层属性替换，例如 runs 或 position；不能覆盖 id 或子元素数组。原文保持不变，只能由用户在 PPT 面板接受或拒绝。', inputSchema: z.object({ artifactId: z.string(), expectedVersion: z.number().int().positive(), operations: z.array(editSchema).min(1).max(40) }), execute: async ({ artifactId, expectedVersion, operations }) => {
      try {
        const artifact = await artifacts.get(artifactId); if (!artifact || artifact.sessionId !== sessionId || artifact.kind !== 'presentation') return { ok: false, error: '未找到本会话演示稿' };
        const content = read(artifact.content);
        for (const ref of options.getReferences?.().filter((r) => r.artifactId === artifactId) ?? []) {
          // Only a slide/element scope is tied to a version; a whole-deck reference just names the deck.
          if ((ref.slideId || ref.elementIds?.length) && ref.version !== artifact.version) throw new Error('引用的页面版本已变化，请重新选择');
          for (const operation of operations) applyPresentationEdit(content, operation as PresentationEdit, ref);
        }
        const review = await reviews.create({ artifactId, sessionId, expectedVersion, operations, origin: { surface: 'chat' } });
        return { ok: true, artifactId, reviewId: review.id, pending: review.changes.length, summary: 'PPT 修改建议已生成，原稿未改变，等待用户审核。' };
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '创建建议失败' }; }
    } }),
  };
}
