export interface AudioGenerateParams {
  prompt: string;
  model?: string;
  voiceId?: string;
  speed?: number;
  pitch?: number;
  vol?: number;
  emotion?: string;
  format?: 'mp3' | 'wav';
  referenceAudioBytes?: Uint8Array;
}

export interface AudioJobResult {
  audioBuffer: Buffer;
  format: 'mp3' | 'wav';
  durationSec?: number;
}

export interface AudioDriverCredentials {
  apiKey?: string;
  baseUrl?: string;
  groupId?: string;
  appId?: string;
}

export interface AudioDriver {
  id: string;
  name: string;
  synthesize(
    params: AudioGenerateParams,
    credentials: AudioDriverCredentials,
  ): Promise<AudioJobResult>;
}
