import type { AudioDriver, AudioDriverCredentials, AudioGenerateParams, AudioJobResult } from './types';

export const cosyvoiceAudioDriver: AudioDriver = {
  id: 'cosyvoice',
  name: '阿里百炼 CosyVoice 驱动',
  async synthesize(
    params: AudioGenerateParams,
    credentials: AudioDriverCredentials,
  ): Promise<AudioJobResult> {
    const apiKey = credentials.apiKey?.trim();
    if (!apiKey) {
      throw new Error('阿里百炼 API Key 未配置，请在平台管理后台配置密钥。');
    }

    const baseUrl = (credentials.baseUrl || 'https://dashscope.aliyuncs.com/api/v1').replace(/\/+$/, '');
    const url = `${baseUrl}/services/aigc/text-to-speech/generation`;

    const payload = {
      model: params.model || 'cosyvoice-v3-flash',
      input: {
        text: params.prompt,
      },
      parameters: {
        voice: params.voiceId || 'longxiaochun',
        format: 'mp3',
        rate: params.speed ?? 1.0,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`阿里百炼 CosyVoice HTTP 请求失败 (${response.status}): ${errText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
      const arrayBuf = await response.arrayBuffer();
      return {
        audioBuffer: Buffer.from(arrayBuf),
        format: 'mp3',
      };
    }

    const json = (await response.json()) as any;
    if (json.code && json.code !== '200' && json.code !== 200) {
      throw new Error(`阿里百炼 CosyVoice 错误 [${json.code}]: ${json.message}`);
    }

    const audioUrl = json.output?.audio_url || json.output?.audio;
    if (audioUrl && typeof audioUrl === 'string' && audioUrl.startsWith('http')) {
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) {
        throw new Error(`无法下载阿里百炼合成音频: ${audioRes.status}`);
      }
      const arrayBuf = await audioRes.arrayBuffer();
      return {
        audioBuffer: Buffer.from(arrayBuf),
        format: 'mp3',
      };
    }

    throw new Error('阿里百炼 CosyVoice 未返回有效音频输出');
  },
};
