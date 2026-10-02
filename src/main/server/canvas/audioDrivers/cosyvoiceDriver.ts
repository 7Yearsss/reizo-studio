import type { AudioDriver, AudioDriverCredentials, AudioDriverOptions, AudioGenerateParams, AudioJobResult } from './types';
import { audioFormat, audioProviderBase, audioProviderMessage, audioResult, formatFromContentType } from './validation';

const modelForRequest = (params: AudioGenerateParams) => params.model?.trim() || 'cosyvoice-v3-flash';

export const cosyvoiceAudioDriver: AudioDriver = {
  id: 'cosyvoice',
  name: '阿里百炼 CosyVoice 驱动',
  defaultModel: 'cosyvoice-v3-flash',
  modelForRequest,
  async synthesize(
    params: AudioGenerateParams,
    credentials: AudioDriverCredentials,
    options: AudioDriverOptions = {},
  ): Promise<AudioJobResult> {
    options.signal?.throwIfAborted();
    const apiKey = credentials.apiKey?.trim();
    if (!apiKey) {
      throw new Error('阿里百炼 API Key 未配置，请在平台管理后台配置密钥。');
    }

    const baseUrl = audioProviderBase(credentials.baseUrl || 'https://dashscope.aliyuncs.com/api/v1');
    const url = `${baseUrl}/services/audio/tts/SpeechSynthesizer`;
    const format = audioFormat(params.format || 'mp3');

    const payload = {
      model: modelForRequest(params),
      input: {
        text: params.prompt,
        voice: params.voiceId || 'longxiaochun',
        format,
        rate: params.speed ?? 1.0,
        ...(params.pitch !== undefined ? { pitch: params.pitch } : {}),
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
      throw new Error(`阿里百炼 CosyVoice HTTP 请求失败 (${response.status}): ${audioProviderMessage(errText, apiKey)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
      const arrayBuf = await response.arrayBuffer();
      options.signal?.throwIfAborted();
      return audioResult(Buffer.from(arrayBuf), format, formatFromContentType(contentType));
    }

    const json = (await response.json()) as { code?: string | number; message?: string; output?: { finish_reason?: string; audio?: { url?: string } } };
    options.signal?.throwIfAborted();
    if (json.code && json.code !== '200' && json.code !== 200) {
      throw new Error(`阿里百炼 CosyVoice 错误 [${json.code}]: ${audioProviderMessage(json.message, apiKey)}`);
    }

    if (json.output?.finish_reason !== 'stop') throw new Error('阿里百炼 CosyVoice 未完成合成或返回无效结果状态');
    const audioUrl = json.output?.audio?.url;
    if (audioUrl && typeof audioUrl === 'string') {
      const downloadUrl = new URL(audioUrl);
      if (!['http:', 'https:'].includes(downloadUrl.protocol) || downloadUrl.username || downloadUrl.password) throw new Error('阿里百炼返回无效音频下载地址');
      const audioRes = await fetch(downloadUrl.href, { signal: options.signal, redirect: 'error' });
      options.signal?.throwIfAborted();
      if (!audioRes.ok) {
        throw new Error(`无法下载阿里百炼合成音频: ${audioRes.status}`);
      }
      const arrayBuf = await audioRes.arrayBuffer();
      options.signal?.throwIfAborted();
      return audioResult(Buffer.from(arrayBuf), format, formatFromContentType(audioRes.headers.get('content-type') || ''));
    }

    throw new Error('阿里百炼 CosyVoice 未返回有效音频输出');
  },
};
