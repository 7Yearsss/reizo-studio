// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { INSPECT_VIDEO_SCRIPT, sampleVideoScript } from './videoPageScripts';

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (globalThis as { __reizoVideo?: unknown }).__reizoVideo; });
it('runs the exact isolated-world script against the video DOM without page globals or transpiler helpers', async () => {
  const video = document.createElement('video'); document.body.append(video);
  Object.defineProperties(video, { readyState: { value: 2 }, videoWidth: { value: 320 }, videoHeight: { value: 710 },
    duration: { value: 152 }, currentSrc: { value: 'blob:https://example.com/video' }, textTracks: { value: [] }, mediaKeys: { value: null } });
  vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 320, height: 710, top: 0, bottom: 710 } as DOMRect);
  vi.spyOn(video, 'pause').mockImplementation(() => undefined);
  const inspect = new Function('document', 'innerHeight', `return ${INSPECT_VIDEO_SCRIPT}`);
  expect(inspect(document, 900)).toMatchObject({ duration: 152 });
  // The frame sampler must also be valid standalone JavaScript after the app build transforms TypeScript.
  expect(() => new Function(`return ${sampleVideoScript(1)}`)).not.toThrow();
});

it('waits for decoded data after a streaming player fires seeked while still buffering', async () => {
  vi.useFakeTimers();
  const video = document.createElement('video'); document.body.append(video);
  let ready = 2, time = 1;
  Object.defineProperties(video, {
    readyState: { get: () => ready }, videoWidth: { value: 320 }, videoHeight: { value: 710 }, duration: { value: 152 },
    currentSrc: { value: 'blob:https://example.com/stream' }, textTracks: { value: [] }, mediaKeys: { value: null },
    currentTime: { get: () => time, set: target => {
      time = target; ready = 1;
      setTimeout(() => video.dispatchEvent(new Event('seeked')), 1);
      setTimeout(() => { ready = 2; video.dispatchEvent(new Event('loadeddata')); }, 50);
    } },
    scrollIntoView: { value: vi.fn() },
  });
  vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 320, height: 710, top: 0, bottom: 710 } as DOMRect);
  vi.spyOn(video, 'pause').mockImplementation(() => undefined);
  vi.spyOn(video, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ drawImage: vi.fn() })) as unknown as HTMLCanvasElement['getContext']);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,ZmFrZQ==');
  new Function('document', 'innerHeight', `return ${INSPECT_VIDEO_SCRIPT}`)(document, 900);
  const outcome = new Function('window', 'document', `return ${sampleVideoScript(10)}`)(window, document)
    .then((value: { timestamp: number }) => ({ value, error: undefined as Error | undefined }), (error: Error) => ({ value: undefined as { timestamp: number } | undefined, error }));
  await vi.advanceTimersByTimeAsync(8500);
  const result = await outcome;
  expect(result.error).toBeUndefined(); expect(result.value?.timestamp).toBe(10);
});
