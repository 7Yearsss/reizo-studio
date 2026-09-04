import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { getCanvasChannel } from './channel';
import { broadcastDownstreamDirty, canvasAssetsDir } from './imageExecutor';
import { getVideoDriver, type VideoGenerateParams } from './videoDrivers';
import { inputHash } from './graph';

interface ActiveJob {
  taskId: string;
  driverId: string;
  canvasId: string;
  nodeId: string;
  startedAt: number;
  timer: ReturnType<typeof setInterval>;
  deferred?: {
    resolve: () => void;
    reject: (err: Error) => void;
  };
}

const activeJobs = new Map<string, ActiveJob>();

export function getActiveJob(canvasId: string, nodeId: string): ActiveJob | undefined {
  return activeJobs.get(`${canvasId}:${nodeId}`);
}

export function cancelVideoJob(canvasId: string, nodeId: string): boolean {
  const key = `${canvasId}:${nodeId}`;
  const job = activeJobs.get(key);
  if (job) {
    clearInterval(job.timer);
    activeJobs.delete(key);
    job.deferred?.resolve();
    return true;
  }
  return false;
}

export function awaitVideoJob(canvasId: string, nodeId: string): Promise<void> {
  const key = `${canvasId}:${nodeId}`;
  const job = activeJobs.get(key);
  if (!job) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const prevResolve = job.deferred?.resolve;
    const prevReject = job.deferred?.reject;
    job.deferred = {
      resolve: () => {
        prevResolve?.();
        resolve();
      },
      reject: (err: Error) => {
        prevReject?.(err);
        reject(err);
      },
    };
  });
}

export async function submitVideoJob(options: {
  canvasStore: CanvasStore;
  settingsStore: SettingsStore;
  dataRoot: string;
  canvasId: string;
  nodeId: string;
  driverId?: string;
  params: VideoGenerateParams;
  providerId?: string;
}): Promise<void> {
  const { canvasStore, settingsStore, dataRoot, canvasId, nodeId, params } = options;
  const channel = getCanvasChannel(canvasId);
  const key = `${canvasId}:${nodeId}`;

  cancelVideoJob(canvasId, nodeId);

  // Set running immediately
  const initialUpdate = canvasStore.updateNode(canvasId, nodeId, {
    runState: 'running',
    output: { progress: 5 },
  });
  if (initialUpdate) {
    channel.broadcast(initialUpdate.rev, {
      type: 'node_output',
      id: nodeId,
      output: { progress: 5 },
      runState: 'running',
    });
  }

  const fail = (errorMsg: string) => {
    cancelVideoJob(canvasId, nodeId);
    const res = canvasStore.updateNode(canvasId, nodeId, {
      runState: 'error',
      output: { error: errorMsg },
    });
    if (res) {
      channel.broadcast(res.rev, {
        type: 'node_output',
        id: nodeId,
        output: { error: errorMsg },
        runState: 'error',
      });
      broadcastDownstreamDirty(canvasStore, canvasId, nodeId, res.rev);
    }
  };

  try {
    const settings = await settingsStore.get();
    const driverId = options.driverId || 'mock';
    const driver = getVideoDriver(driverId);

    // Resolve API key / baseUrl from settings if available
    const stored = settings.providers?.[driverId] || settings.providers?.['kling'] || settings.providers?.['openai'];
    const apiKey = stored?.apiKey;
    const baseUrl = stored?.baseUrl;

    const { taskId } = await driver.submit(params, { apiKey, baseUrl });

    const job: ActiveJob = {
      taskId,
      driverId: driver.id,
      canvasId,
      nodeId,
      startedAt: Date.now(),
      timer: null as unknown as ReturnType<typeof setInterval>,
    };

    job.timer = setInterval(async () => {
      try {
        // Timeout safeguard (10 minutes)
        if (Date.now() - job.startedAt > 10 * 60 * 1000) {
          fail('视频生成超时（10 分钟未返回），请重试。');
          return;
        }

        const pollRes = await driver.poll(taskId, { apiKey, baseUrl });

        if (pollRes.status === 'pending' || pollRes.status === 'processing') {
          const progress = Math.max(10, Math.min(98, pollRes.progress ?? 30));
          const updated = canvasStore.updateNode(canvasId, nodeId, {
            runState: 'running',
            output: { progress },
          });
          if (updated) {
            channel.broadcast(updated.rev, {
              type: 'node_output',
              id: nodeId,
              output: { progress },
              runState: 'running',
            });
          }
          return;
        }

        if (pollRes.status === 'failed') {
          fail(pollRes.error || '视频生成失败');
          return;
        }

        if (pollRes.status === 'succeed') {
          clearInterval(job.timer);

          let videoBuffer: Buffer;
          if (pollRes.videoBuffer) {
            videoBuffer = pollRes.videoBuffer;
          } else if (pollRes.videoUrl) {
            const fetchRes = await fetch(pollRes.videoUrl);
            if (!fetchRes.ok) throw new Error(`Failed to download video file (${fetchRes.status})`);
            videoBuffer = Buffer.from(await fetchRes.arrayBuffer());
          } else {
            throw new Error('Driver succeeded without video data');
          }

          const dir = canvasAssetsDir(dataRoot, canvasId);
          await mkdir(dir, { recursive: true });
          const file = `${nodeId}-${Date.now().toString(36)}.mp4`;
          await writeFile(path.join(dir, file), videoBuffer);
          const relPath = `${canvasId}/${file}`;

          const existingNode = canvasStore.getNode(canvasId, nodeId);
          const prevAssets = existingNode?.output?.assets ?? [];
          const combinedAssets = [relPath, ...prevAssets.filter((p) => p !== relPath)].slice(0, 10);

          const snap = canvasStore.getSnapshot(canvasId);
          const incoming = snap ? snap.edges.filter((e) => e.targetId === nodeId).map((e) => e.sourceId) : [];
          const upstream = incoming
            .map((id) => canvasStore.getNode(canvasId, id))
            .filter((n): n is NonNullable<typeof n> => !!n);
          const paramsHash = existingNode ? inputHash(existingNode, upstream) : null;

          const done = canvasStore.updateNode(canvasId, nodeId, {
            runState: 'done',
            output: { assets: combinedAssets, progress: 100 },
            paramsHash,
          });

          if (done) {
            channel.broadcast(done.rev, {
              type: 'node_output',
              id: nodeId,
              output: { assets: combinedAssets, progress: 100 },
              runState: 'done',
            });
            broadcastDownstreamDirty(canvasStore, canvasId, nodeId, done.rev, false);
          }

          cancelVideoJob(canvasId, nodeId);
          return;
        }
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    }, 2500);

    activeJobs.set(key, job);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}
