import { tool } from 'ai';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Skill } from '../../skills';
import type { CanvasStore } from '../storage/canvasStore';
import { deliveryManifestSchema, deliveryPlanSchema, validateDeliveryPlan } from '../../../shared/skillContract';
import { readCanvasAsset } from '../canvas/assets';
import { selectedAsset } from '../../../shared/canvasReferences';
import type { ArtifactStore } from '../storage/artifactStore';
import { startPresentationExport, PPTX_MIME } from '../canvas/presentationExport';
import { verifyImagePresentation } from '../canvas/presentationValidation';
import { canvasWorkStopped } from '../canvas/workLifecycle';
import { assetAvailableInCanvas } from '../canvas/assetScope';
import { imageSize } from 'image-size';
import { imageDimensionsMatchAspect, parseImageAspectRatio, type ImageGeometry } from '../../../shared/skillContract';

function checkImageGeometry(bytes: Uint8Array, geometry: ImageGeometry, role: string): string[] {
  if (!Object.values(geometry).some((value) => value !== undefined)) return [];
  let width: number; let height: number;
  try {
    const size = imageSize(bytes);
    if (typeof size.width !== 'number' || typeof size.height !== 'number' || !Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) || size.width <= 0 || size.height <= 0) throw new Error('Missing pixel dimensions');
    // JPEG dimensions describe the stored raster; EXIF rotations 5–8 swap its displayed axes.
    [width, height] = size.orientation && size.orientation >= 5 && size.orientation <= 8 ? [size.height, size.width] : [size.width, size.height];
  } catch { return [`${role} 无法从真实图片读取有效宽高，不能确认尺寸条件`]; }
  const issues: string[] = [];
  const actual = `${width}×${height}px`;
  if (geometry.width !== undefined && width !== geometry.width) issues.push(`${role} 宽度要求 ${geometry.width}px，实际 ${actual}`);
  if (geometry.height !== undefined && height !== geometry.height) issues.push(`${role} 高度要求 ${geometry.height}px，实际 ${actual}`);
  if (geometry.minWidth !== undefined && width < geometry.minWidth) issues.push(`${role} 宽度至少 ${geometry.minWidth}px，实际 ${actual}`);
  if (geometry.minHeight !== undefined && height < geometry.minHeight) issues.push(`${role} 高度至少 ${geometry.minHeight}px，实际 ${actual}`);
  if (geometry.aspectRatio) {
    // Round both expected axes to integer pixels, without a percentage-based tolerance.
    if (!imageDimensionsMatchAspect(width, height, geometry.aspectRatio))
      issues.push(`${role} 画幅要求 ${geometry.aspectRatio}（按整数像素取整），实际 ${actual}`);
  }
  return issues;
}

export function createDeliveryTools(options: { skill: Skill; canvasStore: CanvasStore; sessionId: string; dataRoot: string; artifactStore?: ArtifactStore }) {
  const { skill, canvasStore: store, sessionId, dataRoot, artifactStore } = options;
  if (!skill.contract) return undefined;
  const canvasId = () => { if (canvasWorkStopped(store)) throw new Error('应用退出，交付校验已中断'); return store.ensureCanvas(sessionId).id; };
  return {
    ...(artifactStore && skill.contract.requiredExports?.length ? { export_presentation: tool({ description: '把交付计划的有序图片页封装为16:9原生PPTX文件。本地导出，不生成新图片。每页作为可调整的图片，文字包含在页图中。成功后还需check_delivery核验最终交付。',
      inputSchema: z.object({ planId: z.string().min(1), assetIds: z.array(z.string().min(1)).min(1).max(40), title: z.string().trim().min(1).max(160).optional() }),
      execute: async ({ planId, assetIds, title }, context) => {
        const accepted = startPresentationExport({ store, artifactStore, dataRoot, canvasId: canvasId(), operationId: context.toolCallId,
          request: { planId, title, pages: assetIds.map((assetId) => ({ assetId })) }, signal: context.abortSignal });
        await accepted.completion;
        if (canvasWorkStopped(store)) return { error: '应用退出，导出已中断' };
        const job = store.jobs.get(accepted.job.id);
        return { jobId: job.id, nodeId: job.nodeId, status: job.status, ...(job.status === 'succeeded' ? { result: job.result } : { error: job.error ?? '导出未完成' }) };
      },
    }) } : {}),
    plan_delivery: tool({ description: `保存 ${skill.id} 的可校验输入和交付清单。必须先收齐用户选择，再执行。约定：${JSON.stringify(skill.contract)}`,
      inputSchema: deliveryPlanSchema.extend({ planId: z.string().min(1).max(128).optional() }),
      execute: async ({ planId, ...input }) => {
        try {
          const plan = validateDeliveryPlan(skill.contract, input);
          const sources = (plan.input.sourceAssetIds as string[] | undefined) ?? [];
          for (const id of sources) { const asset = store.assets.get(id); if (!asset || !assetAvailableInCanvas(store, canvasId(), asset)) throw new Error(`来源素材 ${id} 不在当前画布中`); }
          for (const item of plan.deliverables) for (const id of sources) if (!item.requiredAssetIds.includes(id)) throw new Error(`${item.role} 必须引用指定来源 ${id}`);
          return store.deliveries.create(canvasId(), skill.id, skill.contract, plan, planId);
        } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
      },
    }),
    read_delivery_plans: tool({ description: '读取本会话的持久交付计划，恢复原输入和未完成项，避免重做已有产物。', inputSchema: z.object({}),
      execute: async () => store.deliveries.list(canvasId()) }),
    check_delivery: tool({ description: '提交产物清单并验证数量、类型、真实文件、明确约定的图像宽高/画幅、精修标记和必要引用。语义、文字与视觉品质仍需人工验收。只有返回 complete=true 才能宣布可测量条件已满足；失败时仅补齐 issues 对应项。',
      inputSchema: z.object({ planId: z.string().min(1), manifest: deliveryManifestSchema }),
      execute: async ({ planId, manifest }, context) => {
        const stopped = () => canvasWorkStopped(store) || context?.abortSignal?.aborted;
        const interrupted = { error: '应用退出或请求已取消，交付校验已中断' };
        if (stopped()) return interrupted;
        const saved = store.deliveries.get(planId);
        if (!saved || saved.canvasId !== canvasId() || saved.skillId !== skill.id) return { error: '本会话未找到该交付计划' };
        const issues: string[] = [];
        const roles = new Map(saved.plan.deliverables.map((item) => [item.role, item]));
        const unique = new Set<string>();
        for (const entry of manifest) {
          const requirement = roles.get(entry.role);
          if (!requirement) { issues.push(`未计划的产物角色 ${entry.role}`); continue; }
          if (unique.has(entry.assetId)) { issues.push(`${entry.role} 重复使用同一文件充当多个交付项`); continue; }
          unique.add(entry.assetId);
          const asset = store.assets.get(entry.assetId);
          if (!asset || asset.kind !== requirement.kind || !assetAvailableInCanvas(store, saved.canvasId, asset)) { issues.push(`${entry.role} 缺少当前画布有效的 ${requirement.kind} 文件`); continue; }
          try {
            const bytes = await readCanvasAsset(dataRoot, asset.path);
            if (stopped()) return interrupted;
            if (!bytes.length || createHash('sha256').update(bytes).digest('hex') !== asset.contentHash) issues.push(`${entry.role} 文件为空或内容已变化`);
            if (asset.kind === 'image') {
              const inputAspect = saved.contract.fields.aspectRatio && parseImageAspectRatio(saved.plan.input.aspectRatio) ? saved.plan.input.aspectRatio as string : undefined;
              const geometry = { ...requirement.geometry, ...(inputAspect ? { aspectRatio: inputAspect } : {}) };
              issues.push(...checkImageGeometry(bytes, geometry, entry.role));
            }
          } catch { issues.push(`${entry.role} 文件无法读取`); }
          if (stopped()) return interrupted;
          const job = asset.jobId ? store.jobs.get(asset.jobId) : null;
          if (asset.source === 'generated' && job?.status !== 'succeeded') issues.push(`${entry.role} 缺少成功执行记录`);
          const captured = job?.input.node as { params?: { draft?: boolean } } | undefined;
          if (saved.contract.outputs.requireFinal && captured?.params?.draft) issues.push(`${entry.role} 仍是草稿版本`);
          const upstream = (job?.input.upstream as import('../../../shared/canvas').CanvasNode[] | undefined) ?? [];
          const used = new Set([...(job?.input.requiredAssetPaths as string[] | undefined ?? []), ...upstream.map(selectedAsset).filter(Boolean)]);
          for (const reference of requirement.requiredAssetIds) {
            const source = store.assets.get(reference);
            if (!source || !assetAvailableInCanvas(store, saved.canvasId, source) || !used.has(source.path)) issues.push(`${entry.role} 未使用必要来源 ${reference}`);
          }
        }
        for (const item of saved.plan.deliverables) {
          const count = manifest.filter((entry) => entry.role === item.role).length;
          if (count !== item.count) issues.push(`${item.role} 需要 ${item.count} 个产物，实际 ${count} 个`);
        }
        for (const required of saved.contract.requiredExports ?? []) {
          const sourceIds = manifest.filter((entry) => roles.get(entry.role)?.kind === 'image').map((entry) => entry.assetId);
          const valid = new Set<string>();
          for (const exported of store.deliveryExports.list(planId).filter((entry) => entry.format === required.format)) {
            if (valid.has(exported.artifactId)) continue;
            try {
              if (!artifactStore) throw new Error('缺少原生文件存储');
              const meta = artifactStore.getMeta(exported.artifactId);
              if (!meta || meta.sessionId !== sessionId || meta.mimeType !== PPTX_MIME || meta.kind !== 'binary' || store.jobs.get(exported.jobId)?.status !== 'succeeded') throw new Error('交付文件会话、格式或任务记录不符');
              if (exported.pageCount !== sourceIds.length || JSON.stringify(exported.sourceAssetIds) !== JSON.stringify(sourceIds)) throw new Error('导出页数或页序与slide清单不符');
              const bytes = await artifactStore.readBlob(exported.artifactId, exported.artifactVersion);
              if (stopped()) return interrupted;
              if (!bytes.length || createHash('sha256').update(bytes).digest('hex') !== exported.contentHash) throw new Error('交付文件缺失或内容已变化');
              verifyImagePresentation(bytes, exported.pageCount); valid.add(exported.artifactId);
            } catch { /* Another published version may match this exact slide manifest. */ }
            if (stopped()) return interrupted;
          }
          if (valid.size < required.count) issues.push(`最终交付缺少 ${required.count} 个已发布且与页图清单一致的 ${required.format.toUpperCase()} 文件`);
        }
        if (stopped()) return interrupted;
        return store.deliveries.finish(planId, manifest, issues);
      },
    }),
  };
}
