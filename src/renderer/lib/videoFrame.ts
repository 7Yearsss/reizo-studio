/**
 * Extract a single still frame from a video as a PNG blob, fully client-side.
 *
 * The source is fetched to a same-origin `blob:` URL first so the offscreen
 * `<video>` is never tainted (drawing a cross-origin video to a canvas would
 * make `toBlob` throw). Nothing here touches the visible player, so the user's
 * playback position is untouched.
 */
export type FramePick = 'start' | 'end' | 'current';

export async function grabVideoFrameBlob(
  httpUrl: string,
  pick: FramePick,
  currentTime = 0,
): Promise<Blob> {
  const resp = await fetch(httpUrl);
  if (!resp.ok) throw new Error(`无法读取视频资源 (${resp.status})`);
  const srcBlob = await resp.blob();
  const objectUrl = URL.createObjectURL(srcBlob);

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('视频解码失败'));
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    let target = 0;
    if (pick === 'start') target = Math.min(0.03, duration);
    else if (pick === 'end') target = Math.max(0, duration - 0.05);
    else target = Math.max(0, Math.min(currentTime, duration || currentTime));

    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error('视频定位失败'));
      // A seek to the current time fires no `seeked` — nudge it.
      if (Math.abs(video.currentTime - target) < 1e-3) target = Math.max(0, target - 0.001);
      video.currentTime = target;
    });

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D 上下文不可用');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('帧编码失败'))),
        'image/png',
      );
    });
  } finally {
    video.src = '';
    URL.revokeObjectURL(objectUrl);
  }
}
