import { spawn } from 'node:child_process';
import { executable, runMediaProcess } from '../canvas/composition';

export interface Interval { start: number; end: number; duration: number }
export interface MediaAnalysis {
  durationSeconds: number;
  hasAudio: boolean;
  hasVideo: boolean;
  silences?: Interval[];
  /** Complement of the silences: where sound is present. Not proof of speech. */
  soundSegments?: Interval[];
  sceneCutsSeconds?: number[];
  truncated: boolean;
}
export interface AnalysisOptions { silenceDb: number; minSilenceSeconds: number; sceneThreshold: number; silence: boolean; scenes: boolean }

const MAX_ITEMS = 200;
const round = (value: number) => Math.round(value * 1000) / 1000;
const interval = (start: number, end: number): Interval => ({ start: round(start), end: round(end), duration: round(end - start) });

/** Parses ffmpeg `silencedetect` log lines. An unterminated final silence runs to the end of the media. */
export function parseSilences(log: string, durationSeconds: number): Interval[] {
  const result: Interval[] = [];
  let open: number | undefined;
  for (const line of log.split(/\r?\n/)) {
    const start = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (start) { open = Math.max(0, Number(start[1])); continue; }
    const end = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (end && open !== undefined) {
      const to = Math.min(durationSeconds, Number(end[1]));
      if (to > open) result.push(interval(open, to));
      open = undefined;
    }
  }
  if (open !== undefined && durationSeconds > open) result.push(interval(open, durationSeconds));
  return result;
}

/** Complement of silences within [0, duration], dropping slivers shorter than `minSeconds`. */
export function soundSegmentsFrom(silences: Interval[], durationSeconds: number, minSeconds = 0.1): Interval[] {
  const result: Interval[] = [];
  let cursor = 0;
  for (const silence of [...silences].sort((a, b) => a.start - b.start)) {
    if (silence.start - cursor >= minSeconds) result.push(interval(cursor, silence.start));
    cursor = Math.max(cursor, silence.end);
  }
  if (durationSeconds - cursor >= minSeconds) result.push(interval(cursor, durationSeconds));
  return result;
}

/** Parses `showinfo` lines emitted for frames that passed select='gt(scene,T)'. */
export function parseSceneCuts(log: string, durationSeconds: number): number[] {
  const cuts: number[] = [];
  for (const line of log.split(/\r?\n/)) {
    if (!line.includes('Parsed_showinfo')) continue;
    const match = /pts_time:\s*(\d+(?:\.\d+)?)/.exec(line);
    if (!match) continue;
    const time = Number(match[1]);
    // A cut at ~0 is the first frame, not a transition.
    if (time > 0.05 && time < durationSeconds) cuts.push(round(time));
  }
  return [...new Set(cuts)].sort((a, b) => a - b);
}

/** ffmpeg writes filter diagnostics to stderr even on success, which runMediaProcess discards. */
function ffmpegLog(command: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, signal });
    let log = '';
    child.stderr.on('data', (bytes) => { log = (log + bytes.toString()).slice(-2 * 1024 * 1024); });
    child.stdout.resume();
    child.once('error', (error) => reject((error as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('未找到 ffmpeg。请安装 FFmpeg，或将 ffmpeg/ffprobe 放入应用 resources 目录。') : error));
    child.once('close', (code) => code === 0 ? resolve(log) : reject(new Error(log.split(/\r?\n/).filter(Boolean).slice(-3).join(' ') || `ffmpeg 退出码 ${code}`)));
  });
}

export async function analyzeMediaFile(file: string, options: AnalysisOptions, signal: AbortSignal): Promise<MediaAnalysis> {
  const probed = JSON.parse(await runMediaProcess(await executable('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], signal)) as {
    format?: { duration?: string }; streams?: Array<{ codec_type?: string }>;
  };
  const durationSeconds = Number(probed.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('无法读取素材时长');
  if (durationSeconds > 3 * 3600) throw new Error('素材超过 3 小时，请先裁出需要分析的片段');
  const hasAudio = Boolean(probed.streams?.some((s) => s.codec_type === 'audio'));
  const hasVideo = Boolean(probed.streams?.some((s) => s.codec_type === 'video'));
  const ffmpeg = await executable('ffmpeg');
  const base = ['-hide_banner', '-nostats', '-nostdin', '-i', file];
  const output: MediaAnalysis = { durationSeconds: round(durationSeconds), hasAudio, hasVideo, truncated: false };
  const [silenceLog, sceneLog] = await Promise.all([
    options.silence && hasAudio
      ? ffmpegLog(ffmpeg, [...base, '-vn', '-af', `silencedetect=noise=${options.silenceDb}dB:d=${options.minSilenceSeconds}`, '-f', 'null', '-'], signal) : Promise.resolve(undefined),
    // Downscale first: scene scores do not need full resolution and decoding dominates the cost.
    options.scenes && hasVideo
      ? ffmpegLog(ffmpeg, [...base, '-an', '-vf', `scale=320:-2,select='gt(scene,${options.sceneThreshold})',showinfo`, '-f', 'null', '-'], signal) : Promise.resolve(undefined),
  ]);
  if (silenceLog !== undefined) {
    const silences = parseSilences(silenceLog, durationSeconds);
    const sounds = soundSegmentsFrom(silences, durationSeconds);
    output.truncated ||= silences.length > MAX_ITEMS || sounds.length > MAX_ITEMS;
    output.silences = silences.slice(0, MAX_ITEMS);
    output.soundSegments = sounds.slice(0, MAX_ITEMS);
  }
  if (sceneLog !== undefined) {
    const cuts = parseSceneCuts(sceneLog, durationSeconds);
    output.truncated ||= cuts.length > MAX_ITEMS;
    output.sceneCutsSeconds = cuts.slice(0, MAX_ITEMS);
  }
  return output;
}
