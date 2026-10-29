import { z } from 'zod';

export const ANALYZE_VIDEO_TOOL = 'analyze_video';
export const MAX_VIDEO_FRAMES = 24;
export const VideoAnalysisInput = z.object({
  url: z.string().url().max(2000),
  signedIn: z.boolean().optional().describe('Use only the login the user saved in browser_open.'),
  startSeconds: z.number().finite().min(0).optional(),
  endSeconds: z.number().finite().positive().optional(),
  frameCount: z.number().int().min(2).max(MAX_VIDEO_FRAMES).optional(),
}).refine(value => value.endSeconds === undefined || value.endSeconds > (value.startSeconds ?? 0), '结束时间必须大于开始时间');
export type VideoAnalysisInput = z.infer<typeof VideoAnalysisInput>;

export interface VideoCaption { start: number; end: number; text: string }
export interface VideoEvidence {
  url: string; title: string; duration: number;
  start: number; end: number;
  frames: Array<{ timestamp: number; jpeg: Buffer }>;
  captions: VideoCaption[];
  audio: 'captions-only' | 'not-transcribed';
}

/** Include both ends of the selected interval; never seek exactly to ended. */
export function videoSampleTimes(duration: number, input: Pick<VideoAnalysisInput, 'startSeconds' | 'endSeconds' | 'frameCount'>): number[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('暂不支持直播或无法确定时长的视频');
  const start = input.startSeconds ?? 0;
  const end = Math.min(input.endSeconds ?? duration, duration);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start >= duration) throw new Error('所选时间段超出视频范围');
  const count = input.frameCount ?? Math.min(16, Math.max(4, Math.ceil((end - start) / 10) + 1));
  if (!Number.isInteger(count) || count < 2 || count > MAX_VIDEO_FRAMES) throw new Error('抽帧数量须为 2–24');
  const last = Math.max(start, end - Math.min(0.15, (end - start) / 4));
  return Array.from({ length: count }, (_, i) => Math.round((start + (last - start) * i / (count - 1)) * 1000) / 1000);
}

/** A bare video/post link means “analyse this”; ordinary text links keep normal chat routing. */
export function bareVideoLink(text: string): string | undefined {
  const input = text.trim().replace(/^<(https?:\/\/[^<>\s]+)>$/, '$1');
  try {
    const url = new URL(input);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || /\s/.test(input)) return;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (/\.(mp4|webm|mov|m4v)(?:$)/i.test(url.pathname)
      || (['x.com', 'twitter.com'].includes(host) && /\/status\/\d+/.test(url.pathname))
      || ['youtube.com', 'youtu.be', 'bilibili.com', 'b23.tv', 'douyin.com', 'v.douyin.com', 'tiktok.com', 'vimeo.com'].includes(host)) return input;
  } catch { /* A normal message. */ }
}
