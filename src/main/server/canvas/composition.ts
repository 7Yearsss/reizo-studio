import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CanvasNode } from '../../../shared/canvas';
import type { CanvasStore } from '../storage/canvasStore';
import { createCanvasApplication, CanvasCommandError } from './application';
import { nodeJobsFor, type NodeJobContext, type NodeJobSubmission } from './nodeJobs';
import { generationSchedulerFor } from './generationScheduler';
import { readCanvasAsset, stageCanvasAssets } from './assets';
import { getCanvasChannel } from './channel';

export const compositionRequest = z.object({ nodeIds: z.array(z.string().min(1)).min(1).max(40),
  width: z.number().int().min(128).max(3840).default(1920), height: z.number().int().min(128).max(3840).default(1080),
  fps: z.number().int().min(12).max(60).default(30), sourceVolume: z.number().min(0).max(2).default(1),
  audioVolume: z.number().min(0).max(2).default(0.8), title: z.string().trim().min(1).max(160).default('最终成片'),
}).refine((input) => input.width % 2 === 0 && input.height % 2 === 0 && new Set(input.nodeIds).size === input.nodeIds.length,
  '镜头不能重复，输出尺寸必须是偶数');
export type CompositionRequest = z.input<typeof compositionRequest>;
interface Clip { nodeId: string; video: string; audio: string[] }

async function executable(name: 'ffmpeg' | 'ffprobe'): Promise<string> {
  const configured = name === 'ffmpeg' ? process.env.REIZO_FFMPEG_PATH : process.env.REIZO_FFPROBE_PATH;
  if (configured) return configured;
  const bundled = path.join(process.resourcesPath ?? '', name + (process.platform === 'win32' ? '.exe' : ''));
  try { if (process.resourcesPath) { await access(bundled); return bundled; } } catch { /* Use the user's installed binary. */ }
  return name;
}

export async function runMediaProcess(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, signal });
    let output = ''; let errors = '';
    child.stdout.on('data', (bytes) => { output = (output + bytes.toString()).slice(-1024 * 1024); });
    child.stderr.on('data', (bytes) => { errors = (errors + bytes.toString()).slice(-4000); });
    child.once('error', (error) => reject((error as NodeJS.ErrnoException).code === 'ENOENT'
      ? new Error(`未找到 ${path.basename(command)}。请安装 FFmpeg，或将 ffmpeg/ffprobe 放入应用 resources 目录。`) : error));
    child.once('close', (code) => code === 0 ? resolve(output) : reject(new Error(errors || `媒体处理退出码 ${code}`)));
  });
}

async function probe(file: string, signal: AbortSignal) {
  const value = JSON.parse(await runMediaProcess(await executable('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], signal));
  const duration = Number(value.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('镜头时长无效或超过一小时');
  return { duration, video: value.streams?.find((stream: { codec_type: string }) => stream.codec_type === 'video'),
    audio: value.streams?.some((stream: { codec_type: string }) => stream.codec_type === 'audio') };
}

export function startComposition(store: CanvasStore, dataRoot: string, canvasId: string, input: unknown, operationId: string, targetNodeId?: string): NodeJobSubmission {
  const parsed = compositionRequest.safeParse(input);
  if (!parsed.success) throw new CanvasCommandError(parsed.error.message);
  const request = parsed.data;
  const existing = store.jobs.findByOperationId(canvasId, operationId);
  if (existing) {
    const previous = compositionRequest.safeParse(existing.input.compositionRequest);
    if (previous.success && JSON.stringify(previous.data) === JSON.stringify(request))
      return { job: existing, completion: Promise.resolve() };
    throw new CanvasCommandError('操作 ID 已用于不同的成片导出', 409);
  }
  const edges = store.getEdges(canvasId);
  const selected = (node: CanvasNode) => node.output?.assets?.[node.output.activeAssetIndex ?? 0];
  const clips = request.nodeIds.map((id): Clip => {
    const node = store.getNode(canvasId, id);
    if (!node || node.type !== 'video' || !selected(node)) throw new CanvasCommandError('所有镜头都需要已有视频产物');
    const audio = edges.filter((edge) => edge.targetId === id).flatMap((edge) => {
      const source = store.getNode(canvasId, edge.sourceId);
      if (source?.type !== 'audio') return [];
      const file = selected(source);
      if (!file) throw new CanvasCommandError(`音轨 ${source.title || source.id} 尚无产物`);
      return [file];
    });
    return { nodeId: id, video: selected(node), audio };
  });
  const app = createCanvasApplication(store);
  return app.batch(canvasId, { kind: 'compose', request }, () => {
    const source = store.getNode(canvasId, request.nodeIds.at(-1));
    const node = targetNodeId ? store.getNode(canvasId, targetNodeId) : app.addNode(canvasId, { type: 'video', x: source.x + source.w + 80, y: source.y, w: 340, h: 420,
      title: request.title, params: { prompt: '', composition: request } }).node;
    if (!node || node.type !== 'video') throw new CanvasCommandError('成片节点不存在', 404);
    const captured = { compositionRequest: request, clips, node };
    const fail = (job: NodeJobContext, error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const result = job.finish('failed', () => store.updateNode(canvasId, node.id, {
        runState: 'error', output: { ...store.getNode(canvasId, node.id)?.output, error: message },
      }), { error: message });
      if (result) getCanvasChannel(canvasId).broadcast(result.rev, { type: 'node_updated', node: result.node });
    };
    return nodeJobsFor(store).start({ canvasId, nodeId: node.id, nodeType: 'video', operationId,
      input: captured, inputHash: createHash('sha256').update(JSON.stringify(captured)).digest('hex'),
      execute: (job) => renderComposition(store, dataRoot, canvasId, captured, job),
      onFailure: (error, job) => fail(job, error),
      onCancelled: (reason) => {
        const current = store.getNode(canvasId, node.id); if (!current) return;
        const result = store.updateNode(canvasId, node.id, { runState: reason === 'interrupted' ? 'error' : 'idle',
          output: { ...current.output, progress: undefined, error: reason === 'interrupted' ? '本地导出因应用退出而中断' : undefined } });
        if (!result) throw new Error('导出取消状态未保存');
        return () => getCanvasChannel(canvasId).broadcast(result.rev, { type: 'node_updated', node: result.node });
      },
    });
  });
}

async function renderComposition(store: CanvasStore, dataRoot: string, canvasId: string,
  input: { compositionRequest: z.output<typeof compositionRequest>; clips: Clip[]; node: CanvasNode }, job: NodeJobContext) {
  const { compositionRequest: request, clips, node } = input;
  const signal = AbortSignal.any([job.signal, AbortSignal.timeout(20 * 60_000)]);
  const release = await generationSchedulerFor(store).acquire('local:composition', signal);
  const tempRoot = path.resolve(os.tmpdir());
  let workDir: string | undefined;
  let staged: Awaited<ReturnType<typeof stageCanvasAssets>> | undefined;
  try {
    workDir = await mkdtemp(path.join(tempRoot, 'reizo-compose-'));
    const ffmpeg = await executable('ffmpeg');
    await runMediaProcess(ffmpeg, ['-version'], signal);
    if (!job.markSubmitted({ providerId: 'local', model: 'ffmpeg' })) return;
    const runningOutput = { ...store.getNode(canvasId, node.id)?.output, progress: 0 };
    delete runningOutput.error;
    const running = store.updateNode(canvasId, node.id, { runState: 'running', output: runningOutput });
    if (!running) throw new Error('成片节点不存在');
    getCanvasChannel(canvasId).broadcast(running.rev, { type: 'node_updated', node: running.node });
    let duration = 0;
    for (let i = 0; i < clips.length; i++) {
      if (!job.isCurrent()) return;
      const clip = clips[i];
      const video = path.join(workDir, `input-${i}${path.extname(clip.video)}`);
      await writeFile(video, await readCanvasAsset(dataRoot, clip.video));
      const info = await probe(video, signal);
      if (!info.video) throw new Error('镜头文件没有视频轨道');
      const args = ['-hide_banner', '-loglevel', 'error', '-i', video];
      for (let j = 0; j < clip.audio.length; j++) {
        const file = path.join(workDir, `audio-${i}-${j}${path.extname(clip.audio[j])}`);
        await writeFile(file, await readCanvasAsset(dataRoot, clip.audio[j]));
        args.push('-i', file);
      }
      const silence = clip.audio.length + 1;
      args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
      const filters = [`[0:v]scale=${request.width}:${request.height}:force_original_aspect_ratio=decrease,pad=${request.width}:${request.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${request.fps},setpts=PTS-STARTPTS[v]`,
        `[${info.audio ? 0 : silence}:a]aresample=48000,volume=${request.sourceVolume},apad,atrim=duration=${info.duration},asetpts=PTS-STARTPTS[a0]`];
      for (let j = 0; j < clip.audio.length; j++) filters.push(`[${j + 1}:a]aresample=48000,volume=${request.audioVolume},apad,atrim=duration=${info.duration},asetpts=PTS-STARTPTS[a${j + 1}]`);
      filters.push(`${Array.from({ length: clip.audio.length + 1 }, (_, j) => `[a${j}]`).join('')}amix=inputs=${clip.audio.length + 1}:normalize=0,alimiter=limit=0.95,atrim=duration=${info.duration}[a]`);
      args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]', '-t', String(info.duration),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', path.join(workDir, `clip-${i}.mp4`));
      await runMediaProcess(ffmpeg, args, signal);
      duration += info.duration;
      if (!job.isCurrent()) return;
      const result = store.updateNode(canvasId, node.id, { runState: 'running', output: { ...store.getNode(canvasId, node.id)?.output, progress: Math.round((i + 1) * 90 / clips.length) } });
      if (job.isCurrent() && result) getCanvasChannel(canvasId).broadcast(result.rev, { type: 'node_updated', node: result.node });
    }
    await writeFile(path.join(workDir, 'list.txt'), clips.map((_, i) => `file 'clip-${i}.mp4'`).join('\n'));
    const finalPath = path.join(workDir, 'final.mp4');
    await runMediaProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(workDir, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', finalPath], signal);
    const info = await probe(finalPath, signal);
    if (!info.video || !info.audio || info.video.width !== request.width || info.video.height !== request.height || Math.abs(info.duration - duration) > clips.length / request.fps + 0.5)
      throw new Error('导出的画幅、轨道或总时长与计划不符');
    if (!job.isCurrent()) return;
    store.usage.setReport(`job:${job.id}`, 'local-output', [{ metric: 'video_seconds', unit: 'second', quantity: info.duration, source: 'observed_output' }]);
    staged = await stageCanvasAssets(dataRoot, canvasId, [{ name: `composition-${job.id}.mp4`, bytes: await readFile(finalPath), kind: 'video', mimeType: 'video/mp4' }], signal);
    staged.prepareCommit();
    const result = job.finish('succeeded', () => {
      const current = store.getNode(canvasId, node.id);
      if (!current) throw new Error('成片节点不存在');
      const asset = store.assets.register({ ...staged.files[0], canvasId, nodeId: node.id, jobId: job.id, source: 'generated' });
      store.assets.updateMetadata(asset.id, { name: request.title, folder: '成片' });
      const previous = { ...current.output };
      delete previous.error; delete previous.progress;
      const output = { ...previous, assets: [asset.path, ...(previous.assets ?? []).filter((path) => path !== asset.path)].slice(0, 10),
        resultSet: [{ asset: asset.path, assetId: asset.id, createdAt: asset.createdAt, jobId: job.id, generation: asset.generation,
          providerId: asset.providerId, model: asset.model, inputHash: asset.inputHash },
        ...(previous.resultSet ?? []).filter((item) => item.asset !== asset.path)].slice(0, 10), activeAssetIndex: 0, durationSec: info.duration };
      const updated = store.updateNode(canvasId, node.id, { runState: 'done', params: { ...current.params, importedAssetId: asset.id }, output });
      if (!updated) throw new Error('成片节点不存在');
      return updated;
    }, { result: { assets: [staged.files[0].path], durationSec: info.duration, width: request.width, height: request.height } });
    if (result) { staged.keep(); getCanvasChannel(canvasId).broadcast(result.rev, { type: 'node_updated', node: result.node }); }
  } finally {
    release();
    await staged?.discard();
    if (workDir && path.dirname(path.resolve(workDir)) === tempRoot) await rm(workDir, { recursive: true, force: true });
  }
}
