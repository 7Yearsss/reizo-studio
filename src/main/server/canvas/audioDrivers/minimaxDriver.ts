import type { AudioDriver, AudioDriverCredentials, AudioGenerateParams, AudioJobResult } from './types';

export const minimaxAudioDriver: AudioDriver = {
  id: 'minimax',
  name: 'MiniMax 语音驱动',
  async synthesize(
    params: AudioGenerateParams,
    credentials: AudioDriverCredentials,
  ): Promise<AudioJobResult> {
    const apiKey = credentials.apiKey?.trim();
    if (!apiKey) {
      throw new Error('MiniMax API Key 未配置，请在平台管理后台配置密钥。');
    }

    const baseUrl = (credentials.baseUrl || 'https://api.minimax.chat/v1').replace(/\/+$/, '');
    let url = `${baseUrl}/t2a_v2`;
    if (credentials.groupId?.trim()) {
      url += `?GroupId=${encodeURIComponent(credentials.groupId.trim())}`;
    }

    const payload = {
      model: params.model || 'speech-01-turbo',
      text: params.prompt,
      stream: false,
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
        format: 'mp3',
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
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`MiniMax HTTP 请求失败 (${response.status}): ${errText}`);
    }

    const contentType = response.headers.get('content-type') || '';

    // If returned raw binary audio stream
    if (contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
      const arrayBuf = await response.arrayBuffer();
      return {
        audioBuffer: Buffer.from(arrayBuf),
        format: 'mp3',
      };
    }

    const json = (await response.json()) as any;
    if (json.base_resp && json.base_resp.status_code !== 0) {
      throw new Error(`MiniMax 错误 [${json.base_resp.status_code}]: ${json.base_resp.status_msg}`);
    }

    const hexAudio = json.data?.audio;
    if (!hexAudio || typeof hexAudio !== 'string') {
      throw new Error('MiniMax 未返回有效的音频数据 (缺少 data.audio)');
    }

    const audioBuffer = Buffer.from(hexAudio, 'hex');
    return {
      audioBuffer,
      format: 'mp3',
    };
  },
};
