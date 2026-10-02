import type { AudioDriver, AudioDriverCredentials, AudioDriverOptions, AudioGenerateParams, AudioJobResult } from './types';
import { audioFormat, audioProviderBase, audioProviderMessage, audioResult, formatFromContentType } from './validation';

const modelForRequest = (params: AudioGenerateParams) => params.model?.trim() || 'speech-01-turbo';

export const minimaxAudioDriver: AudioDriver = {
  id: 'minimax',
  name: 'MiniMax 语音驱动',
  defaultModel: 'speech-01-turbo',
  modelForRequest,
  async synthesize(
    params: AudioGenerateParams,
    credentials: AudioDriverCredentials,
    options: AudioDriverOptions = {},
  ): Promise<AudioJobResult> {
    options.signal?.throwIfAborted();
    const apiKey = credentials.apiKey?.trim();
    if (!apiKey) {
      throw new Error('MiniMax API Key 未配置，请在平台管理后台配置密钥。');
    }

    const baseUrl = audioProviderBase(credentials.baseUrl || 'https://api.minimax.io/v1');
    const format = audioFormat(params.format || 'mp3');
    let url = `${baseUrl}/t2a_v2`;
    if (credentials.groupId?.trim()) {
      url += `?GroupId=${encodeURIComponent(credentials.groupId.trim())}`;
    }

    const payload = {
      model: modelForRequest(params),
      text: params.prompt,
      stream: false,
      output_format: 'hex',
      voice_setting: {
        voice_id: params.voiceId || 'female-tianmei',
        speed: params.speed ?? 1.0,
        vol: params.vol ?? 1.0,
        pitch: params.pitch ?? 0,
        emotion: params.emotion || 'neutral',
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format,
        channel: 1,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: options.signal,
      redirect: 'error',
    });
    options.signal?.throwIfAborted();

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      options.signal?.throwIfAborted();
      throw new Error(`MiniMax HTTP 请求失败 (${response.status}): ${audioProviderMessage(errText, apiKey)}`);
    }

    const contentType = response.headers.get('content-type') || '';

    // If returned raw binary audio stream
    if (contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
      const arrayBuf = await response.arrayBuffer();
      options.signal?.throwIfAborted();
      return audioResult(Buffer.from(arrayBuf), format, formatFromContentType(contentType));
    }

    const json = (await response.json()) as {
      base_resp?: { status_code?: number; status_msg?: string }; data?: { audio?: string; status?: number };
      extra_info?: { audio_format?: string; audio_length?: number };
    };
    options.signal?.throwIfAborted();
    if (!json.base_resp || json.base_resp.status_code !== 0) {
      if (!json.base_resp) throw new Error('MiniMax 未返回有效的业务结果状态');
      throw new Error(`MiniMax 错误 [${json.base_resp.status_code}]: ${audioProviderMessage(json.base_resp.status_msg, apiKey)}`);
    }
    if (json.data?.status !== 2) throw new Error('MiniMax 音频生成未完成或结果状态无效');

    const hexAudio = json.data?.audio;
    if (!hexAudio || typeof hexAudio !== 'string' || hexAudio.length % 2 !== 0 || !/^[\da-f]+$/i.test(hexAudio)) {
      throw new Error('MiniMax 未返回有效的音频数据 (缺少 data.audio)');
    }

    const result = audioResult(Buffer.from(hexAudio, 'hex'), format, json.extra_info?.audio_format);
    if (Number.isFinite(json.extra_info?.audio_length) && json.extra_info.audio_length > 0) result.durationSec = json.extra_info.audio_length / 1_000;
    return result;
  },
};
