import { afterEach, describe, expect, it, vi } from 'vitest';
import { cosyvoiceAudioDriver, getAudioDriver, minimaxAudioDriver, mockAudioDriver } from './audioDrivers';
import { audioResult } from './audioDrivers/validation';

afterEach(() => { vi.unstubAllGlobals(); });
const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const speech = (audio: Buffer = MP3, format = 'mp3') => ({ base_resp: { status_code: 0 }, data: { status: 2, audio: audio.toString('hex') }, extra_info: { audio_format: format, audio_length: 1_200 } });
function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe('audio driver protocol and admission contract', () => {
  it('sends the resolved MiniMax model/format once with transport signal kept outside the paid payload', async () => {
    const wav = (await mockAudioDriver.synthesize({ prompt: 'local sample' }, {})).audioBuffer;
    const fetcher = vi.fn().mockResolvedValueOnce(json(speech(wav, 'wav'))); vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    const params = { prompt: 'hello', model: 'speech-02-hd', format: 'wav' as const };
    const model = minimaxAudioDriver.modelForRequest(params, {});
    const result = await minimaxAudioDriver.synthesize({ ...params, model }, { apiKey: 'secret', baseUrl: 'http://127.0.0.1:9999/v1', groupId: 'group' }, { signal });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:9999/v1/t2a_v2?GroupId=group');
    const init = fetcher.mock.calls[0][1];
    expect(init).toMatchObject({ method: 'POST', signal, redirect: 'error' });
    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({ model, stream: false, output_format: 'hex', audio_setting: { format: 'wav' } });
    expect(payload.signal).toBeUndefined(); expect(payload.apiKey).toBeUndefined();
    expect(result).toMatchObject({ format: 'wav', durationSec: 1.2 });
    expect(result.audioBuffer).toEqual(wav);
  });

  it('supports existing two-argument MiniMax callers and validates a nonempty actual MP3 response', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(speech())); vi.stubGlobal('fetch', fetcher);
    const result = await minimaxAudioDriver.synthesize({ prompt: 'hello' }, { apiKey: 'secret' });
    expect(result.audioBuffer).toEqual(MP3); expect(result.format).toBe('mp3');
    expect(fetcher.mock.calls[0][0]).toBe('https://api.minimax.io/v1/t2a_v2');
    expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe('speech-01-turbo');
  });

  it.each([
    { base_resp: { status_code: 1004, status_msg: 'rejected' }, data: { status: 2, audio: MP3.toString('hex') } },
    { data: { status: 2, audio: MP3.toString('hex') } },
    { base_resp: { status_code: 0 }, data: { status: 1, audio: MP3.toString('hex') } },
    { base_resp: { status_code: 0 }, data: { status: 2, audio: '' } },
    { base_resp: { status_code: 0 }, data: { status: 2, audio: 'zzff' } },
    { base_resp: { status_code: 0 }, data: { status: 2, audio: 'fff' } },
    speech(Buffer.from('not audio')),
    speech(MP3, 'ogg'),
  ])('rejects invalid MiniMax business/audio result %j without retrying POST', async (response) => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(response)); vi.stubGlobal('fetch', fetcher);
    await expect(minimaxAudioDriver.synthesize({ prompt: 'text' }, { apiKey: 'secret' })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('uses CosyVoice official HTTP fields and complete nested output URL with one POST and a cancellable GET', async () => {
    const wav = (await mockAudioDriver.synthesize({ prompt: 'local' }, {})).audioBuffer;
    const fetcher = vi.fn().mockResolvedValueOnce(json({ output: { finish_reason: 'stop', audio: { url: 'https://audio.example/signed.wav?token=download' } } }))
      .mockResolvedValueOnce(new Response(Uint8Array.from(wav), { headers: { 'content-type': 'audio/wav' } }));
    vi.stubGlobal('fetch', fetcher); const signal = new AbortController().signal;
    const result = await cosyvoiceAudioDriver.synthesize({ prompt: 'hello', model: 'cosyvoice-v3-plus', voiceId: 'voice', speed: 1.2, format: 'wav' }, { apiKey: 'secret', baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1' }, { signal });
    expect(fetcher.mock.calls[0][0]).toBe('https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ model: 'cosyvoice-v3-plus', input: { text: 'hello', voice: 'voice', format: 'wav', rate: 1.2 } });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', signal });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ signal, redirect: 'error' });
    expect(fetcher.mock.calls[1][1].headers).toBeUndefined();
    expect(result.audioBuffer).toEqual(wav); expect(result.format).toBe('wav');
  });

  it.each([
    { code: 'InvalidApiKey', message: 'bad credentials', output: { finish_reason: 'stop', audio: { url: 'https://audio.example/result.mp3' } } },
    { output: { finish_reason: null, audio: { url: 'https://audio.example/result.mp3' } } },
    { output: { finish_reason: 'stop', audio_url: 'https://audio.example/legacy.mp3' } },
    { output: { finish_reason: 'stop', audio: { url: 'file:///secret' } } },
  ])('rejects incomplete/failed CosyVoice result %j without a download or POST retry', async (response) => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(response)); vi.stubGlobal('fetch', fetcher);
    await expect(cosyvoiceAudioDriver.synthesize({ prompt: 'text' }, { apiKey: 'secret' })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['minimax', 'cosyvoice', 'mock'] as const)('does not dispatch %s when its transport signal was already cancelled', async (id) => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const abort = new AbortController(); abort.abort(new Error('stopped'));
    await expect(getAudioDriver(id).synthesize({ prompt: 'text' }, { apiKey: 'secret' }, { signal: abort.signal })).rejects.toThrow('stopped');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('drops an ignored-Abort CosyVoice POST response before it can initiate a download', async () => {
    const paused = deferred<Response>(); const fetcher = vi.fn(() => paused.promise); vi.stubGlobal('fetch', fetcher);
    const abort = new AbortController(); const operation = cosyvoiceAudioDriver.synthesize({ prompt: 'text' }, { apiKey: 'secret' }, { signal: abort.signal });
    abort.abort(new Error('stopped')); paused.resolve(json({ output: { finish_reason: 'stop', audio: { url: 'https://audio.example/late.mp3' } } }));
    await expect(operation).rejects.toThrow('stopped'); expect(fetcher).toHaveBeenCalledOnce();
  });

  it('passes cancellation to a download and rejects late bytes from an ignored-Abort response', async () => {
    const paused = deferred<Response>(); const reached = deferred<void>();
    const fetcher = vi.fn().mockResolvedValueOnce(json({ output: { finish_reason: 'stop', audio: { url: 'https://audio.example/result.mp3' } } }))
      .mockImplementationOnce(() => { reached.resolve(); return paused.promise; });
    vi.stubGlobal('fetch', fetcher); const abort = new AbortController();
    const operation = cosyvoiceAudioDriver.synthesize({ prompt: 'text' }, { apiKey: 'secret' }, { signal: abort.signal });
    await reached.promise; abort.abort(new Error('stopped')); paused.resolve(new Response(MP3, { headers: { 'content-type': 'audio/mpeg' } }));
    await expect(operation).rejects.toThrow('stopped'); expect(fetcher.mock.calls[1][1].signal).toBe(abort.signal);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects empty/unknown/mismatched binary containers and redacts a key echoed in provider errors', async () => {
    expect(() => audioResult(Buffer.alloc(0), 'mp3')).toThrow('empty');
    expect(() => audioResult(Buffer.from('not audio'), 'mp3')).toThrow('unsupported');
    expect(() => audioResult(MP3, 'wav')).toThrow('different format');
    expect(() => audioResult(MP3, 'mp3', 'flac')).toThrow('mp3 or wav');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('bad key secret', { status: 401 })));
    try { await minimaxAudioDriver.synthesize({ prompt: 'text' }, { apiKey: 'secret' }); }
    catch (error) { expect((error as Error).message).toContain('[redacted]'); expect((error as Error).message).not.toContain(' secret'); }
  });

  it.each(['minimax', 'cosyvoice'] as const)('does not retry a %s POST on HTTP or transport failure', async (id) => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('temporary failure', { status: 503 })).mockRejectedValueOnce(new TypeError('network offline'));
    vi.stubGlobal('fetch', fetcher);
    await expect(getAudioDriver(id).synthesize({ prompt: 'text' }, { apiKey: 'secret' })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(getAudioDriver(id).synthesize({ prompt: 'text' }, { apiKey: 'secret' })).rejects.toThrow('network offline');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects late raw MiniMax body bytes when a response reader ignores cancellation', async () => {
    const paused = deferred<ArrayBuffer>(); const reached = deferred<void>();
    const response = new Response(MP3, { headers: { 'content-type': 'audio/mpeg' } });
    vi.spyOn(response, 'arrayBuffer').mockImplementationOnce(() => { reached.resolve(); return paused.promise; });
    const fetcher = vi.fn().mockResolvedValueOnce(response); vi.stubGlobal('fetch', fetcher);
    const abort = new AbortController(); const running = minimaxAudioDriver.synthesize({ prompt: 'text' }, { apiKey: 'secret' }, { signal: abort.signal });
    await reached.promise; abort.abort(new Error('stopped')); paused.resolve(new Uint8Array(MP3).buffer);
    await expect(running).rejects.toThrow('stopped'); expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects metadata-only MP3 and WAV containers with no audio data', () => {
    const tag = Buffer.alloc(10); tag.write('ID3');
    expect(() => audioResult(tag, 'mp3')).toThrow('invalid or unsupported');
    const wav = Buffer.alloc(44); wav.write('RIFF'); wav.write('WAVE', 8); wav.write('data', 36);
    expect(() => audioResult(wav, 'wav')).toThrow('invalid or unsupported');
  });
});
