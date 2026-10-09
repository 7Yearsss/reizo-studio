import { z } from 'zod';

export const skillContractSchema = z.object({ version: z.literal(1),
  fields: z.record(z.string(), z.object({ type: z.enum(['text', 'choice', 'integer', 'assetIds', 'stringList']),
    required: z.boolean().default(true), options: z.array(z.string()).optional(), min: z.number().optional(), max: z.number().optional() })),
  outputs: z.object({ kinds: z.array(z.enum(['image', 'video', 'audio'])).min(1), requiredRoles: z.array(z.string()),
    rolesFrom: z.string().optional(), countFrom: z.string().optional(), minCount: z.number().int().positive().default(1),
    requireFinal: z.boolean().default(true) }),
  requiredExports: z.array(z.object({ format: z.literal('pptx'), count: z.number().int().min(1).max(10).default(1) })).optional(),
});
export type SkillContract = z.infer<typeof skillContractSchema>;

export function validateSkillInput(contract: SkillContract, input: unknown): Record<string, unknown> {
  const fields: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(contract.fields)) {
    let schema: z.ZodType;
    if (field.type === 'integer') schema = z.number().int().min(field.min ?? 1).max(field.max ?? 100);
    else if (field.type === 'assetIds' || field.type === 'stringList') schema = z.array(z.string().trim().min(1).max(160)).min(field.min ?? 1).max(field.max ?? 40);
    else if (field.type === 'choice') {
      if (!field.options?.length) throw new Error(`技能约定 ${key} 缺少选项`);
      schema = z.enum(field.options as [string, ...string[]]);
    } else schema = z.string().trim().min(field.min ?? 1).max(field.max ?? 2000);
    fields[key] = field.required ? schema : schema.optional();
  }
  return z.object(fields).strict().parse(input);
}

/** Explicit width:height numbers, independent of deliverable role names. */
export function parseImageAspectRatio(value: unknown): [number, number] | undefined {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value)) return undefined;
  const [width, height] = value.split(':').map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? [width, height] : undefined;
}

export function imageDimensionsMatchAspect(width: number, height: number, aspectRatio: string): boolean {
  const ratio = parseImageAspectRatio(aspectRatio);
  return Boolean(ratio && Math.round(height * ratio[0] / ratio[1]) === width && Math.round(width * ratio[1] / ratio[0]) === height);
}

export const imageGeometrySchema = z.object({
  aspectRatio: z.string().trim().max(64).refine((value) => Boolean(parseImageAspectRatio(value)), '画幅必须是有效的宽:高数字比例').optional(),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
  minWidth: z.number().int().positive().optional(), minHeight: z.number().int().positive().optional(),
}).strict().superRefine((value, context) => {
  if (value.width && value.minWidth && value.width < value.minWidth) context.addIssue({ code: 'custom', path: ['width'], message: '指定宽度小于最低宽度' });
  if (value.height && value.minHeight && value.height < value.minHeight) context.addIssue({ code: 'custom', path: ['height'], message: '指定高度小于最低高度' });
  if (value.width && value.height && value.aspectRatio && !imageDimensionsMatchAspect(value.width, value.height, value.aspectRatio)) context.addIssue({ code: 'custom', path: ['aspectRatio'], message: '指定宽高与画幅不一致' });
});
export type ImageGeometry = z.infer<typeof imageGeometrySchema>;

export const deliveryPlanSchema = z.object({ input: z.record(z.string(), z.unknown()),
  deliverables: z.array(z.object({ role: z.string().min(1).max(80), title: z.string().min(1).max(160),
    kind: z.enum(['image', 'video', 'audio']), count: z.number().int().min(1).max(40).default(1),
    requiredAssetIds: z.array(z.string().min(1)).max(20).default([]), geometry: imageGeometrySchema.optional() })).min(1).max(40),
});
export type DeliveryPlan = z.infer<typeof deliveryPlanSchema>;
export const deliveryManifestSchema = z.array(z.object({ role: z.string().min(1), assetId: z.string().min(1) })).max(200);
export type DeliveryManifest = z.infer<typeof deliveryManifestSchema>;
export interface SavedDeliveryPlan { id: string; canvasId: string; skillId: string; contract: SkillContract; plan: DeliveryPlan;
  manifest: DeliveryManifest; complete: boolean; issues: string[]; createdAt: string; updatedAt: string }

export function validateDeliveryPlan(contract: SkillContract, value: unknown): DeliveryPlan {
  const plan = deliveryPlanSchema.parse(value);
  plan.input = validateSkillInput(contract, plan.input);
  const inputAspect = contract.fields.aspectRatio && parseImageAspectRatio(plan.input.aspectRatio) ? plan.input.aspectRatio as string : undefined;
  for (const item of plan.deliverables) {
    if (item.geometry && item.kind !== 'image') throw new Error(`${item.role} 的图像尺寸条件只能用于图片`);
    if (item.kind !== 'image' || !inputAspect) continue;
    const specified = parseImageAspectRatio(item.geometry?.aspectRatio);
    const expected = parseImageAspectRatio(inputAspect);
    if (specified && expected && specified[0] / specified[1] !== expected[0] / expected[1]) throw new Error(`${item.role} 的画幅与用户选择 ${inputAspect} 不一致`);
    item.geometry = { ...item.geometry, aspectRatio: inputAspect };
    imageGeometrySchema.parse(item.geometry);
  }
  const required = [...contract.outputs.requiredRoles, ...(contract.outputs.rolesFrom ? plan.input[contract.outputs.rolesFrom] as string[] ?? [] : [])];
  if (new Set(plan.deliverables.map((item) => item.role)).size !== plan.deliverables.length) throw new Error('交付角色不能重复');
  for (const role of required) if (!plan.deliverables.some((item) => item.role === role)) throw new Error(`交付清单缺少 ${role}`);
  const count = plan.deliverables.reduce((total, item) => total + item.count, 0);
  if (count < contract.outputs.minCount || contract.outputs.countFrom && count !== plan.input[contract.outputs.countFrom]) throw new Error('交付数量不符合技能约定');
  if (plan.deliverables.some((item) => !contract.outputs.kinds.includes(item.kind))) throw new Error('交付类型不符合技能约定');
  return plan;
}
