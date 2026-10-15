import { z } from 'zod';

const id = z.string().min(1).max(200);
const seconds = z.number().finite().min(0).max(86400);
export const sourceInspectionSchema = z.object({
  editSessionId: id,
  sources: z.array(z.object({ assetId: id, fromSeconds: seconds.optional(), toSeconds: seconds.optional(), count: z.number().int().min(2).max(8).default(6) }).strict()).min(1).max(4),
}).strict();
export const shotSelectionsSchema = z.array(z.object({
  evidenceId: z.string().uuid(),
  observedFrames: z.array(z.number().int().nonnegative()).min(1).max(8),
  role: z.enum(['opening', 'detail', 'context', 'ending']),
  reason: z.string().trim().min(1).max(350),
}).strict()).min(1).max(100);
export type ShotSelections = z.infer<typeof shotSelectionsSchema>;
