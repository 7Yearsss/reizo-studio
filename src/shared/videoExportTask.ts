export type VideoExportPhase = 'queued' | 'submitting' | 'rendering' | 'saving' | 'saved' | 'cancelling' | 'cancelled' | 'failed' | 'interrupted';

export interface VideoExportTask {
  id: string;
  projectId: string;
  name: string;
  phase: VideoExportPhase;
  progress: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  assetId?: string;
  retryId?: string;
}
