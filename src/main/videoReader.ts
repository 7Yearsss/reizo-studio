import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserWindow, Session } from 'electron';
import { browserRequestAllowed } from '../shared/browserUrl';
import { videoSampleTimes, type VideoAnalysisInput, type VideoCaption, type VideoEvidence } from '../shared/videoAnalysis';
import { assertPublicBrowserPage, BROWSER_PARTITION, hardenBrowserSession } from './browserSession';
import { INSPECT_VIDEO_SCRIPT, sampleVideoScript } from './videoPageScripts';

export interface VideoPage {
  metadata(): Promise<{ title: string; duration: number } | null>;
  sample(time: number): Promise<{ timestamp: number; jpeg: Buffer; captions: VideoCaption[] }>;
  close(): Promise<void>;
}
export const VIDEO_ANALYSIS_TIMEOUT_MS = 180_000;
const MAX_FRAME_BYTES = 512 * 1024;
let readers = 0;

export function directVideoDocument(url: string): string {
  const escaped = url.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>视频</title><style>html,body{margin:0;background:#000;height:100%;display:grid;place-items:center}video{max-width:100vw;max-height:100vh}</style><video controls preload="auto" src="${escaped}"></video>`);
}

/** Transport-independent collection: deterministic samples, real timestamps, and no invented audio transcript. */
export async function collectVideoEvidence(input: VideoAnalysisInput, page: VideoPage, signal: AbortSignal): Promise<VideoEvidence> {
  let metadata: Awaited<ReturnType<VideoPage['metadata']>>;
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      signal.throwIfAborted(); metadata = await page.metadata();
      if (metadata) break;
      await delay(500, undefined, { signal });
    }
    if (!metadata) throw new Error('未找到可读取的视频。若网站要求登录，请先用 browser_open 让用户登录，再以 signedIn:true 重试；也可提供视频直链。');
    const times = videoSampleTimes(metadata.duration, input);
    const frames: VideoEvidence['frames'] = [];
    const captions = new Map<string, VideoCaption>();
    for (const time of times) {
      signal.throwIfAborted();
      const frame = await page.sample(time);
      if (!Number.isFinite(frame.timestamp) || Math.abs(frame.timestamp - time) > 1) throw new Error('读取到的画面时间不符，请重新分析');
      if (!frame.jpeg.length || frame.jpeg.length > MAX_FRAME_BYTES) throw new Error('视频画面为空或超出大小限制');
      frames.push({ timestamp: frame.timestamp, jpeg: frame.jpeg });
      for (const cue of frame.captions.slice(0, 500)) {
        if (Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > (input.startSeconds ?? 0) && cue.start < (input.endSeconds ?? metadata.duration) && cue.text) {
          const bounded = { start: cue.start, end: cue.end, text: cue.text.slice(0, 2000) };
          if (captions.size < 500) captions.set(`${cue.start}:${cue.end}:${bounded.text}`, bounded);
        }
      }
    }
    signal.throwIfAborted();
    return { url: input.url, title: metadata.title.slice(0, 500), duration: metadata.duration,
      start: input.startSeconds ?? 0, end: Math.min(input.endSeconds ?? metadata.duration, metadata.duration), frames,
      captions: [...captions.values()].sort((a, b) => a.start - b.start), audio: captions.size ? 'captions-only' : 'not-transcribed' };
  } finally { await page.close(); }
}

/** Chromium's media decoder handles MP4/WebM and supported HLS players on both Windows and macOS. */
export async function readBrowserVideo(input: VideoAnalysisInput, outerSignal?: AbortSignal): Promise<VideoEvidence> {
  outerSignal?.throwIfAborted();
  await assertPublicBrowserPage(input.url);
  outerSignal?.throwIfAborted();
  if (readers >= 2) throw new Error('已有两个视频正在分析，请稍后重试');
  readers++;
  const signal = AbortSignal.any([AbortSignal.timeout(VIDEO_ANALYSIS_TIMEOUT_MS), ...(outerSignal ? [outerSignal] : [])]);
  let win: BrowserWindow | undefined;
  let ses: Session | undefined;
  const abort = () => { if (win && !win.isDestroyed()) win.destroy(); };
  const close = async () => {
    signal.removeEventListener('abort', abort); abort();
    if (ses && !input.signedIn) await ses.clearStorageData().catch((): void => undefined);
  };
  try {
    const { BrowserWindow: Window, session, nativeImage } = await import('electron');
    signal.throwIfAborted();
    ses = session.fromPartition(input.signedIn ? BROWSER_PARTITION : `reizo-video-${randomUUID()}`);
    hardenBrowserSession(ses);
    win = new Window({ show: false, width: 1280, height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, session: ses, webSecurity: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, target) => { if (!browserRequestAllowed(target)) event.preventDefault(); });
    win.webContents.on('will-redirect', (event, target) => { if (!browserRequestAllowed(target)) event.preventDefault(); });
    signal.addEventListener('abort', abort, { once: true });
    const direct = /\.(mp4|webm|mov|m4v)$/i.test(new URL(input.url).pathname);
    const load = win.loadURL(direct ? directVideoDocument(input.url) : input.url);
    // Some players keep the load event pending behind ads; inspect once their DOM is ready.
    await Promise.race([load, delay(15_000, undefined, { signal })]);
    signal.throwIfAborted();
    const contents = win.webContents;
    const run = (code: string) => contents.executeJavaScriptInIsolatedWorld(1777, [{ code }], true);
    return await collectVideoEvidence(input, {
      metadata: () => run(INSPECT_VIDEO_SCRIPT),
      sample: async time => {
        const out = await run(sampleVideoScript(time)) as { timestamp: number; jpeg: string | null; captions: VideoCaption[]; rect: { x: number; y: number; width: number; height: number } };
        let image;
        if (out.jpeg?.startsWith('data:image/jpeg;base64,') && out.jpeg.length < 2_000_000) image = nativeImage.createFromDataURL(out.jpeg);
        else {
          const size = win.getContentSize();
          const x = Math.max(0, Math.ceil(out.rect.x)), y = Math.max(0, Math.ceil(out.rect.y));
          const width = Math.floor(Math.min(out.rect.width, size[0] - x)), height = Math.floor(Math.min(out.rect.height, size[1] - y));
          if (![x, y, width, height].every(Number.isFinite) || width < 2 || height < 2) throw new Error('视频画面不在可读取区域');
          image = await contents.capturePage({ x, y, width, height }, { stayHidden: true, stayAwake: true });
        }
        if (image.isEmpty()) throw new Error('未能读取视频画面');
        const size = image.getSize();
        if (Math.max(size.width, size.height) > 960) image = image.resize(size.width >= size.height ? { width: 960 } : { height: 960 });
        return { timestamp: out.timestamp, jpeg: image.toJPEG(72), captions: out.captions };
      }, close,
    }, signal);
  } catch (error) {
    if (signal.aborted) throw new Error(outerSignal?.aborted ? '视频分析已取消' : '视频读取超时，请检查网络、登录状态，或缩小分析时间段后重试');
    if (error instanceof Error && /ERR_[A-Z_]+/.test(error.message)) throw new Error('无法打开视频页面，请检查网络，或在内置浏览器登录该网站后重试');
    throw error;
  } finally { await close(); readers--; }
}
