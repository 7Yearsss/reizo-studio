import { z } from 'zod';

const seconds = z.number().finite().min(0).max(3600);
const assetId = z.string().min(1).max(200);
const timedText = z.object({ text: z.string().trim().min(1).max(180), startSeconds: seconds, endSeconds: seconds });
export const videoCompositionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']),
  fit: z.enum(['contain', 'cover']),
  durationSeconds: z.number().finite().positive().max(3600),
  shots: z.array(z.object({ assetId, sourceStartSeconds: seconds, durationSeconds: z.number().finite().positive().max(3600), volume: z.number().min(0).max(1) })).min(1).max(100),
  title: timedText.nullable(),
  captions: z.array(timedText).max(300),
  captionSource: z.enum(['user-provided', 'verified-transcript', 'authored-copy', 'none']),
  music: z.object({ assetId, sourceStartSeconds: seconds, volume: z.number().min(0).max(1), fadeSeconds: z.number().min(0).max(5) }).nullable(),
}).strict();
export type VideoComposition = z.infer<typeof videoCompositionSchema>;

export interface CompositionPreview {
  id: string;
  editSessionId: string;
  timelineId: string;
  createdAt: number;
  summary: string;
  plan?: VideoComposition;
  name?: string;
  frames: number[];
  imageCount: number;
}
