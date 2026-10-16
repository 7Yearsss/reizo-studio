import { z } from 'zod';
import type { CompositionPreview } from './videoComposition';
import type { VideoExportTask } from './videoExportTask';

const id = z.string().min(1).max(200);
export const editorActivitySchema = z.object({
  id, at: z.number().finite(),
  state: z.enum(['working', 'tool_returned', 'awaiting_review', 'awaiting_confirmation', 'applied', 'rejected', 'exporting', 'saving', 'saved', 'failed', 'cancelled']),
  message: z.string().max(1000),
});
export const editorContextSchema = z.object({
  projectId: id,
  timeline: z.object({ id, name: z.string().max(300), fps: z.number().positive(), width: z.number().positive(), height: z.number().positive(), itemCount: z.number().int().nonnegative() }),
  playheadFrame: z.number().nonnegative().nullable(),
  selectedMedia: z.array(z.object({ id, name: z.string().max(300), kind: z.string().max(30), offline: z.boolean() })).max(200),
  selectedClips: z.array(z.object({ id, name: z.string().max(300), kind: z.string().max(30), track: z.string().max(200), startFrame: z.number(), durationInFrames: z.number(), assetId: z.string().max(200).optional() })).max(200),
  awaiting: z.enum(['review', 'confirmation']).nullable(),
  exporting: z.boolean(),
});
export type EditorContext = z.infer<typeof editorContextSchema>;
export type EditorActivity = z.infer<typeof editorActivitySchema>;
export interface EditorObservation {
  exports?: VideoExportTask[];
  composition?: CompositionPreview | null;
  connected: boolean;
  observedAt: number | null;
  context: EditorContext | null;
  activities: EditorActivity[];
}
