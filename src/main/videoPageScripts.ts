/** These functions run in an isolated Chromium world. They touch only the chosen video and its text tracks. */
function inspectVideo() {
  const scope = globalThis as typeof globalThis & { __reizoVideo?: { video: HTMLVideoElement; source: string } };
  const videos: HTMLVideoElement[] = [];
  const scan = (doc: Document) => {
    videos.push(...doc.querySelectorAll('video'));
    for (const frame of doc.querySelectorAll('iframe')) {
      try { if (frame.contentDocument) scan(frame.contentDocument); } catch { /* Cross-origin embeds need their own public URL. */ }
    }
  };
  scan(document);
  const candidates = videos.filter(video => {
    const rect = video.getBoundingClientRect();
    return video.isConnected && rect.width > 1 && rect.height > 1;
  }).sort((a, b) => {
    const score = (v: HTMLVideoElement) => {
      const r = v.getBoundingClientRect();
      return r.width * r.height * (r.bottom > 0 && r.top < innerHeight ? 10 : 1);
    };
    return score(b) - score(a);
  });
  const video = scope.__reizoVideo?.video ?? candidates[0];
  if (!video) return null;
  video.muted = true;
  video.preload = 'auto';
  if (video.mediaKeys) throw new Error('受保护的视频无法分析');
  if (video.readyState < 2 || !video.videoWidth) { void video.play().catch((): void => undefined); return null; }
  video.pause();
  scope.__reizoVideo = { video, source: video.currentSrc };
  for (const track of Array.from(video.textTracks)) if (track.kind === 'captions' || track.kind === 'subtitles') track.mode = 'hidden';
  return { title: document.title.slice(0, 500), duration: video.duration };
}

async function sampleVideo(timestamp: number) {
  const scope = globalThis as typeof globalThis & { __reizoVideo?: { video: HTMLVideoElement; source: string } };
  const state = scope.__reizoVideo;
  if (!state || !state.video.isConnected || state.video.currentSrc !== state.source) throw new Error('视频已切换，请重新分析');
  const video = state.video;
  video.pause(); video.muted = true;
  video.scrollIntoView({ block: 'center', inline: 'center' });
  // An MSE stream can begin just after zero. Do not ask for a frame before its first sample.
  const first = video.seekable.length ? video.seekable.start(0) : 0;
  const target = first > timestamp && first - timestamp <= 0.25 ? first + 0.001 : timestamp;
  if (Math.abs(video.currentTime - timestamp) > 0.06 || video.readyState < 2) {
    await new Promise<void>((resolve, reject) => {
      const events = ['seeked', 'loadeddata', 'canplay', 'progress', 'timeupdate'];
      const cleanup = () => {
        clearTimeout(timer); clearTimeout(prime); clearInterval(poll);
        for (const event of events) video.removeEventListener(event, done);
        video.removeEventListener('error', fail);
      };
      const done = () => {
        if (video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - target) < 0.75) {
          video.pause(); cleanup(); resolve();
        }
      };
      const fail = () => { cleanup(); reject(new Error('视频解码失败')); };
      const timer = setTimeout(() => {
        cleanup(); reject(new Error('视频定位超时，请稍后重试'));
      }, 15000);
      // Some players fetch the requested MSE fragment only while playback is active. Pause as soon as decoded.
      const prime = setTimeout(() => { void video.play().catch((): void => undefined); }, 800);
      const poll = setInterval(done, 100);
      for (const event of events) video.addEventListener(event, done);
      video.addEventListener('error', fail);
      video.currentTime = target;
    });
  }
  await new Promise(resolve => setTimeout(resolve, 120));
  if (Math.abs(video.currentTime - timestamp) > 1 || state.video.currentSrc !== state.source) throw new Error('视频无法定位到指定时间');
  const captions: Array<{ start: number; end: number; text: string }> = [];
  for (const track of Array.from(video.textTracks)) {
    if (track.kind !== 'captions' && track.kind !== 'subtitles') continue;
    for (const cue of Array.from(track.cues ?? [])) {
      const text = 'text' in cue ? String(cue.text).slice(0, 2000) : '';
      if (text && captions.length < 500) captions.push({ start: cue.startTime, end: cue.endTime, text });
    }
  }
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  let jpeg: string | null = null;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    jpeg = canvas.toDataURL('image/jpeg', 0.76);
  } catch { /* A cross-origin player may taint a canvas; capture only its visible video rectangle instead. */ }
  const bounds = video.getBoundingClientRect();
  let x = bounds.x, y = bounds.y;
  let current: Window | null = video.ownerDocument.defaultView;
  while (current && current !== window) {
    const frame = current.frameElement;
    if (!frame) break;
    const rect = frame.getBoundingClientRect(); x += rect.x; y += rect.y; current = current.parent;
  }
  return { timestamp: video.currentTime, jpeg, captions, rect: { x, y, width: bounds.width, height: bounds.height } };
}

export const INSPECT_VIDEO_SCRIPT = `(${inspectVideo.toString()})()`;
export const sampleVideoScript = (timestamp: number): string => `(${sampleVideo.toString()})(${JSON.stringify(timestamp)})`;
