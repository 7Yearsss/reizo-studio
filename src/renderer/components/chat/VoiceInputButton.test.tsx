// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import VoiceInputButton from './VoiceInputButton';
const mock = vi.hoisted(() => ({ load: vi.fn(), transcribe: vi.fn(), dispose: vi.fn(), request: vi.fn(), start: vi.fn(), finish: vi.fn(), cancel: vi.fn() }));
vi.mock('../../api', () => ({ apiOrigin: async () => 'http://127.0.0.1:47100' }));
vi.mock('../../lib/voice/recognizer', () => ({ LocalRecognizer: class { load = mock.load; transcribe = mock.transcribe; dispose = mock.dispose; } }));
vi.mock('../../lib/voice/recording', () => ({ requestVoiceRecording: mock.request }));
let root: Root, host: HTMLDivElement;
const result = vi.fn();
function button(label: string) { const el = host.querySelector<HTMLButtonElement>('[aria-label="' + label + '"]'); if (!el) throw new Error(label); return el; }
async function click(label: string) { await act(async () => button(label).click()); }
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ready: true }))));
  mock.load.mockResolvedValue(undefined); mock.start.mockResolvedValue(undefined); mock.transcribe.mockResolvedValue('识别的内容');
  mock.finish.mockResolvedValue(new Float32Array(16000).fill(0.1));
  mock.request.mockResolvedValue({ start: mock.start, finish: mock.finish, cancel: mock.cancel, level: () => 0.5 });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<VoiceInputButton onTranscript={result} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('records, transcribes and returns text exactly once without any send action', async () => {
  await click('语音输入'); expect(mock.start).toHaveBeenCalledOnce();
  await click('结束录音并转文字');
  expect(result).toHaveBeenCalledWith('识别的内容'); expect(result).toHaveBeenCalledOnce();
  expect(mock.dispose).toHaveBeenCalled(); expect(host.querySelector('[aria-label="语音输入面板"]')).toBeNull();
});
it('cancels late microphone acquisition when switching away from this tab', async () => {
  const permission = pending<unknown>(); mock.request.mockReturnValue(permission.promise);
  await click('语音输入');
  await act(async () => root.render(<VoiceInputButton active={false} onTranscript={result} />));
  await act(async () => permission.resolve({ start: mock.start, finish: mock.finish, cancel: mock.cancel, level: () => 0 }));
  expect(mock.cancel).toHaveBeenCalled(); expect(mock.start).not.toHaveBeenCalled(); expect(result).not.toHaveBeenCalled();
});
it('discards recognition after cancellation and uses the latest callback for a current result', async () => {
  const answer = pending<string>(); mock.transcribe.mockReturnValue(answer.promise);
  await click('语音输入'); await click('结束录音并转文字'); await click('取消语音输入');
  await act(async () => answer.resolve('迟到结果')); expect(result).not.toHaveBeenCalled();
  mock.transcribe.mockResolvedValue('新结果'); await click('语音输入');
  const next = vi.fn(); await act(async () => root.render(<VoiceInputButton onTranscript={next} />));
  await click('结束录音并转文字'); expect(next).toHaveBeenCalledWith('新结果');
});
it('handles permission denial and silence without inserting text', async () => {
  mock.request.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
  await click('语音输入'); expect(host.textContent).toContain('麦克风权限未开启');
  await click('取消语音输入'); mock.finish.mockResolvedValue(new Float32Array(16000));
  await click('语音输入'); await click('结束录音并转文字');
  expect(host.textContent).toContain('没有检测到清晰语音'); expect(mock.transcribe).not.toHaveBeenCalled(); expect(result).not.toHaveBeenCalled();
});
it('does not let a cancelled audio decode clear a newer recording', async () => {
  const decoding = pending<Float32Array>(); mock.finish.mockReturnValueOnce(decoding.promise);
  await click('语音输入'); await click('结束录音并转文字'); await click('取消语音输入');
  const nextFinish = vi.fn().mockResolvedValue(new Float32Array(16000).fill(0.1));
  mock.request.mockResolvedValueOnce({ start: mock.start, finish: nextFinish, cancel: mock.cancel, level: () => 0.5 });
  await click('语音输入');
  await act(async () => decoding.resolve(new Float32Array(16000).fill(0.1)));
  await click('结束录音并转文字');
  expect(nextFinish).toHaveBeenCalledOnce(); expect(result).toHaveBeenCalledOnce();
});
