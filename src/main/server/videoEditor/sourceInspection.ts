import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sourceInspectionSchema, shotSelectionsSchema, type ShotSelections } from '../../../shared/videoSelection';
import type { VideoComposition } from '../../../shared/videoComposition';
import type { VideoToolResult } from '../../../shared/videoEditor';
import type { CompositionProject } from './composition';
import { editorResult } from './mcpClient';

type Call = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<VideoToolResult>;
type Asset = CompositionProject['mediaPool']['assets'][number];
type Project = CompositionProject & { projectId: string };
interface Evidence {
  id: string; projectId: string; editSessionId: string; assetId: string; name: string;
  fingerprint: string; fps: number; fromFrame: number; toFrame: number;
  frames: number[]; createdAt: number; result: VideoToolResult;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
// Compare source identity and timebase, not mutable UI selection/favorite/name.
const fingerprint = (asset: Asset, fps: number) => hash(JSON.stringify([asset.id, asset.src, asset.kind, asset.durationInFrames, asset.offline ?? false, fps]));
const warning = '仅依据抽样静帧进行视觉选段；未分析语音或声音，未逐帧观看，不能保证未抽样处无黑帧、抖动或动作变化。';

/** Conversation-scoped evidence, reusable after restart but tied to the exact draft/source. */
export class SourceInspections {
  constructor(private root: string) {}
  private directory(sessionId: string) { return path.join(this.root, 'video-editor-inspections', hash(sessionId)); }
  async read(sessionId: string, id: string): Promise<Evidence> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('观察记录标识无效');
    try { return JSON.parse(await readFile(path.join(this.directory(sessionId), `${id}.json`), 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('未找到当前对话的观察记录，请重新查看素材'); throw e; }
  }
  private async save(sessionId: string, record: Evidence) {
    const dir = this.directory(sessionId); await mkdir(dir, { recursive: true });
    const temporary = path.join(dir, `${record.id}.tmp`);
    await writeFile(temporary, JSON.stringify(record)); await rename(temporary, path.join(dir, `${record.id}.json`));
  }
  async inspect(sessionId: string, input: unknown, call: Call, signal?: AbortSignal): Promise<VideoToolResult> {
    const { editSessionId, sources } = sourceInspectionSchema.parse(input);
    signal?.throwIfAborted();
    const project = editorResult(await call('read_project', { editSessionId }, signal)) as unknown as Project;
    const fps = project.timeline?.fps;
    if (!project.projectId || !Number.isFinite(fps) || fps < 1 || fps > 240) throw new Error('素材工程或帧率无效');
    // Validate the entire batch before extracting anything. No implicit latest-version choice.
    const targets = sources.map(source => {
      const asset = project.mediaPool.assets.find(a => a.id === source.assetId);
      if (!asset || !['video', 'image'].includes(asset.kind)) throw new Error('请使用完整的视频或图片素材 ID；音频不能用静帧分析');
      if (asset.offline || !asset.src) throw new Error(`素材「${asset.name}」离线`);
      if (!Number.isInteger(asset.durationInFrames) || asset.durationInFrames < 1) throw new Error(`素材「${asset.name}」时长未知`);
      const fromFrame = Math.round((source.fromSeconds ?? 0) * fps);
      const toFrame = source.toSeconds === undefined ? asset.durationInFrames : Math.round(source.toSeconds * fps);
      if (fromFrame < 0 || toFrame <= fromFrame || toFrame > asset.durationInFrames || asset.kind === 'image' && (fromFrame !== 0 || source.toSeconds !== undefined)) throw new Error('抽样范围越界；图片请省略时间范围');
      const frames = asset.kind === 'image' ? [0] : [...new Set(Array.from({ length: source.count }, (_, i) => Math.min(toFrame - 1, Math.floor(fromFrame + (i + 0.5) * (toFrame - fromFrame) / source.count))))];
      return { asset, fromFrame, toFrame, frames };
    });
    const content: VideoToolResult['content'] = [{ type: 'text', text: warning }];
    for (const target of targets) {
      signal?.throwIfAborted();
      const result = await call('view_asset_frames', { editSessionId, assetId: target.asset.id, frames: target.frames }, signal);
      const metadata = editorResult(result);
      const images = result.content.filter(p => p.type === 'image' && p.data && ['image/jpeg', 'image/png', 'image/webp'].includes(p.mimeType ?? ''));
      // Trust returned coordinates, never fabricate evidence from requested frames.
      const frames = metadata.frames;
      if (metadata.error || metadata.coordinateSpace !== 'source' || metadata.assetId !== target.asset.id || !images.length || !Array.isArray(frames) || !frames.length || frames.length > 8 || frames.some(f => !Number.isInteger(f) || f < target.fromFrame || f >= target.toFrame)) throw new Error(`「${target.asset.name}」未返回可核对的源画面，不能据此选段`);
      signal?.throwIfAborted();
      const record: Evidence = { id: randomUUID(), projectId: project.projectId, editSessionId, assetId: target.asset.id, name: target.asset.name, fingerprint: fingerprint(target.asset, fps), fps, fromFrame: target.fromFrame, toFrame: target.toFrame, frames, createdAt: Date.now(), result };
      await this.save(sessionId, record);
      content.push({ type: 'text', text: JSON.stringify({ evidenceId: record.id, assetId: record.assetId, name: record.name, fps, rangeSeconds: [record.fromFrame / fps, record.toFrame / fps], observedFrames: frames, observedSeconds: frames.map(f => f / fps), layout: metadata.layout, note: metadata.note, next: 'Inspect the following source images. Select for the user theme, visual clarity, variety and continuity. For promising ranges not densely covered, call video_editor_inspect_sources again with a narrow range. Then video_editor_rough_cut with one selection per shot, citing actual observedFrames and concrete visual reasons. Stills do not prove speech, motion quality, precise scene boundaries or audio content.' }) }, ...images);
    }
    return { content };
  }
  async validator(sessionId: string, editSessionId: string, plan: VideoComposition, input: ShotSelections) {
    const selections = shotSelectionsSchema.parse(input);
    if (selections.length !== plan.shots.length) throw new Error('每个粗剪镜头都需要对应的观察依据和选段理由');
    const records = await Promise.all(selections.map(s => this.read(sessionId, s.evidenceId)));
    return (project: CompositionProject): string => {
      const projectId = (project as Project).projectId;
      const lines = plan.shots.map((shot, i) => {
        const record = records[i], selection = selections[i];
        const asset = project.mediaPool.assets.find(a => a.id === shot.assetId);
        if (!asset || record.projectId !== projectId || record.editSessionId !== editSessionId || record.assetId !== shot.assetId || record.fingerprint !== fingerprint(asset, project.timeline.fps)) throw new Error('观察记录与当前工程、草稿或素材版本不一致，请重新查看素材');
        const start = Math.round(shot.sourceStartSeconds * record.fps), end = start + Math.round(shot.durationSeconds * record.fps);
        const frames = [...new Set(selection.observedFrames)].sort((a, b) => a - b);
        if (frames.some(f => !record.frames.includes(f))) throw new Error('引用了未实际返回的画面，请使用 observedFrames 中的帧号');
        if (asset.kind === 'video') {
          if (start < record.fromFrame || end > record.toFrame || frames.some(f => f < start || f >= end)) throw new Error('选段超出所引用画面的范围，请先查看目标片段');
          if (frames[0] - start > record.fps || end - 1 - frames[frames.length - 1] > record.fps || frames.some((f, j) => j > 0 && f - frames[j - 1] > 2 * record.fps)) throw new Error('所选片段抽样过疏，请对候选时间范围加密查看后再粗剪');
        }
        const role = { opening: '开场', detail: '细节', context: '交代场景', ending: '收尾' }[selection.role];
        return `${i + 1}. ${role} · ${asset.name} · 源 ${start / record.fps}–${end / record.fps} 秒\n选段理由（AI 判断）：${selection.reason}\n观察时间：${frames.map(f => (f / record.fps).toFixed(2)).join('、')} 秒`;
      });
      return `选段依据\n${lines.join('\n')}\n${warning}`;
    };
  }
}
