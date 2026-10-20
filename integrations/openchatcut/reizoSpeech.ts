// Reizo adapter for the pinned OpenChatCut local ASR and draft transcript commands.
import type { AgentContext } from './context';
import type { AgentToolSchema } from './tool-schema';
import { sourceRevisionOf } from '../editor/mediaSourceRevision';
import { timelineItemAssetId } from '../editor/mediaAssetUsage';
import { hasOperationalTranscript } from '../transcript/types';
import { kvGet, kvSet } from '../persist/sharedKv';

import { ReizoSpeechJobs, type SpeechJob } from './reizoSpeechJobs';
const jobs = new ReizoSpeechJobs({ get: key => kvGet<SpeechJob>(key), set: (key, value) => kvSet(key, value) }, async () => {
  const { __resetLocalAsrClient } = await import('../transcript/local-asr');
  __resetLocalAsrClient();
});
export const REIZO_SPEECH_SCHEMAS: AgentToolSchema[] = [{
  name: 'reizo_speech_job', description: 'Local-only source ASR. start/status compute/read persistent data; attach explicitly puts completed words on one exact draft clip. Never applies the draft.',
  input_schema: { type: 'object', properties: {
    action: { type: 'string', enum: ['start', 'status', 'attach', 'cancel'] }, itemId: { type: 'string' },
    language: { type: 'string', enum: ['zh', 'en'] }, jobId: { type: 'string' }, retry: { type: 'boolean' },
  }, required: ['action', 'itemId'] },
}];

export async function execReizoSpeech(args: Record<string, unknown>, ctx: AgentContext) {
  const action = String(args.action), projectId = ctx.getProjectId?.();
  const item = ctx.getState().items.find(i => i.id === args.itemId);
  if (!projectId || !item || !['video', 'audio'].includes(item.kind) || !item.src) throw new Error('请选择当前草稿中准确的音频或视频片段 ID');
  const assets = ctx.getDoc().assets;
  const asset = assets.find(a => a.id === timelineItemAssetId(item, assets));
  if (!asset || asset.src !== item.src || ctx.getOfflineMediaSrcs?.().has(item.src)) throw new Error('片段源素材缺失或离线');
  if (item.transcriptStale || item.deletedWordIdx?.length || item.transcriptPlayOrder?.length || Object.keys(item.gapCapsMs ?? {}).length || item.silenceFrames != null) throw new Error('该片段已有文字剪辑或过期转录，请先确认恢复方式，避免改变已有时间轴');
  const revision = sourceRevisionOf(asset), language = args.language === 'en' ? 'en' : 'zh';
  const model = globalThis.localStorage?.getItem('cc.asrModel') || 'base';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([projectId, asset.id, revision, language, model])));
  const id = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (args.jobId !== undefined && args.jobId !== id) throw new Error('任务与当前源版本、语言或模型不一致，请重新识别');
  const publicJob = (job: SpeechJob | undefined) => job ? { ...job, words: undefined, wordCount: job.words?.length ?? 0, next: job.status === 'done' ? 'Call attach explicitly, then read_transcript. No timeline was changed by recognition.' : 'Keep this editor open. Poll status with a wait; do not repeatedly start or infer completion from elapsed time.' } : { status: 'not_found', id };
  if (action === 'start') {
    const job = await jobs.start({ id, projectId, assetId: asset.id, revision, language, model, status: 'running' }, async progress => {
      const { localTranscribePath } = await import('../transcript/local-asr');
      if ((globalThis.localStorage?.getItem('cc.asrModel') || 'base') !== model) throw new Error('识别模型设置已变化，请重新启动识别');
      const result = await localTranscribePath(asset.src, () => progress('正在本地识别'), { languageCode: language, diarize: false });
      return result.words;
    }, args.retry === true);
    return publicJob(job);
  }
  if (action === 'cancel') return publicJob(await jobs.cancel(projectId, id));
  const job = await jobs.read(projectId, id);
  if (action === 'status') return publicJob(job);
  if (action !== 'attach') throw new Error('未知语音操作');
  if (!job || job.status !== 'done' || !job.words?.length) throw new Error('尚无已完成的有效语音结果，不能写入字幕');
  // Re-read after async storage operations; never attach a stale result to a changed source.
  const current = ctx.getState().items.find(i => i.id === item.id);
  const currentAsset = ctx.getDoc().assets.find(a => a.id === asset.id);
  if (!current || current.src !== item.src || !currentAsset || sourceRevisionOf(currentAsset) !== revision) throw new Error('识别期间源素材发生变化，未写入');
  if (current.transcriptStale || current.deletedWordIdx?.length || current.transcriptPlayOrder?.length || Object.keys(current.gapCapsMs ?? {}).length || current.silenceFrames != null) throw new Error('片段文字剪辑状态已变化，未写入');
  if (hasOperationalTranscript(current)) return { status: 'already_attached', itemId: current.id, wordCount: current.transcript.length, note: '保留已有转录及人工修正，没有覆盖' };
  ctx.commands.setItemTranscript(item.id, job.words);
  return { status: 'attached', itemId: item.id, wordCount: job.words.length, sourceAssetId: asset.id, language, note: '自动识别结果需核对；源时间戳保留，片段时长未改变' };
}
