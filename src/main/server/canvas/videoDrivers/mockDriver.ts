import type { VideoDriver, VideoGenerateParams, VideoJobStatus } from './types';

interface MockTask {
  startedAt: number;
  params: VideoGenerateParams;
}

const mockTasks = new Map<string, MockTask>();

/** Minimal valid MP4 container (ftyp + moov + mdat) so HTML5 video players load cleanly */
const MINIMAL_MP4 = Buffer.from(
  '0000001c6674797069736f6d0000020069736f6d69736f32617663310000000866726565' +
    '000000086d646174' +
    '000000786d6f6f760000006c6d766864000000000000000000000000000003e800000000' +
    '000100000100000000000000000000000001000000000000000000000000000000010000' +
    '000000000000000000000000400000000000000000000000000000000000000000000000' +
    '000000000000000000000002',
  'hex',
);

export const mockDriver: VideoDriver = {
  id: 'mock',
  name: '模拟预览 (Dev Mock)',

  async submit(params: VideoGenerateParams): Promise<{ taskId: string }> {
    const taskId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    mockTasks.set(taskId, { startedAt: Date.now(), params });
    return { taskId };
  },

  async poll(taskId: string): Promise<VideoJobStatus> {
    const task = mockTasks.get(taskId);
    if (!task) {
      return { status: 'failed', error: `Task "${taskId}" not found` };
    }

    const elapsed = (Date.now() - task.startedAt) / 1000;
    if (elapsed < 1.5) {
      return { status: 'pending', progress: 15 };
    }
    if (elapsed < 3.5) {
      const progress = Math.min(95, Math.round(15 + ((elapsed - 1.5) / 2) * 80));
      return { status: 'processing', progress };
    }

    mockTasks.delete(taskId);
    return {
      status: 'succeed',
      progress: 100,
      videoBuffer: MINIMAL_MP4,
    };
  },
};
