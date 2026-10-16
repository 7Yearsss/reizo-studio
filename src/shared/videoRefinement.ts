import { z } from 'zod';

const itemId = z.string().min(1).max(200);
export const videoRefinementSchema = z.array(z.discriminatedUnion('action', [
  z.object({ action: z.literal('text'), itemId, text: z.string().trim().min(1).max(180).optional(), fontSizeScale: z.number().finite().min(0.25).max(2).optional() }).strict(),
  z.object({ action: z.literal('volume'), itemId, volume: z.number().finite().min(0).max(1) }).strict(),
  z.object({ action: z.literal('shorten_shot'), itemId, seconds: z.number().finite().positive().max(3600) }).strict(),
])).min(1).max(20);
export type VideoRefinement = z.infer<typeof videoRefinementSchema>;
