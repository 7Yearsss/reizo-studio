export type ProviderCategory = 'audio' | 'video' | 'image' | 'llm';

export interface ProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
  appId?: string;
  groupId?: string;
}

export interface VoicePreset {
  id: string;
  name: string;
  tag?: string;
  gender?: 'female' | 'male' | 'neutral';
  previewUrl?: string;
}

export interface ModelPreset {
  id: string;
  name: string;
  badge?: string;
  description?: string;
}

/** Full provider configuration stored in server backend (Admin Only). */
export interface ManagedProviderConfig {
  id: string;
  name: string;
  category: ProviderCategory;
  driverType: string;
  description?: string;
  credentials: ProviderCredentials;
  sampleParams: Record<string, unknown>;
  availableModels?: ModelPreset[];
  voicePresets?: VoicePreset[];
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Stripped, sanitized provider catalog item exposed to end-user clients. Zero credentials leakage. */
export interface PublicProviderCatalogItem {
  id: string;
  name: string;
  category: ProviderCategory;
  driverType: string;
  description?: string;
  hasKey: boolean;
  sampleParams: Record<string, unknown>;
  availableModels: ModelPreset[];
  voicePresets: VoicePreset[];
  enabled: boolean;
  isDefault: boolean;
}

export interface ProviderCatalogResponse {
  providers: PublicProviderCatalogItem[];
  defaultProviderByCategory: Partial<Record<ProviderCategory, string>>;
}

/** Predefined official templates for quick onboarding in admin panel */
export const DEFAULT_PROVIDER_TEMPLATES: Omit<ManagedProviderConfig, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'minimax-audio-default',
    name: 'MiniMax 语音 (海螺大模型)',
    category: 'audio',
    driverType: 'minimax',
    description: 'MiniMax Speech-01-Turbo 情感多模态语音大模型，超逼真自然呼吸感与情绪掌控。',
    credentials: {
      baseUrl: 'https://api.minimax.chat/v1',
      apiKey: '',
      groupId: '',
    },
    sampleParams: {
      model: 'speech-01-turbo',
      voice_id: 'female-tianmei',
      speed: 1.0,
      vol: 1.0,
      pitch: 0,
      emotion: 'neutral',
      format: 'mp3',
    },
    availableModels: [
      { id: 'speech-01-turbo', name: 'Speech-01 Turbo (低延迟/推荐)', badge: '推荐' },
      { id: 'speech-01-hd', name: 'Speech-01 HD (高保真广播级)' },
      { id: 'speech-02', name: 'Speech-02 (最新多模态拟真)' },
    ],
    voicePresets: [
      { id: 'female-tianmei', name: '甜美女声 (小海螺)', gender: 'female', tag: '短视频/解说' },
      { id: 'female-yujie', name: '知性御姐', gender: 'female', tag: '有声书/独白' },
      { id: 'male-qingxin', name: '清新男声 (朝阳)', gender: 'male', tag: '旁白/纪录片' },
      { id: 'presenter_male', name: '标准新闻男声', gender: 'male', tag: '播报/严肃' },
      { id: 'audiobook_female', name: '温润女声', gender: 'female', tag: '睡前故事' },
    ],
    enabled: true,
    isDefault: true,
  },
  {
    id: 'cosyvoice-audio-default',
    name: '阿里百炼 CosyVoice',
    category: 'audio',
    driverType: 'cosyvoice',
    description: '阿里千问百炼语音合成大模型，超低单价（0.08元/千字），支持丰富中文方言与自然对话。',
    credentials: {
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      apiKey: '',
    },
    sampleParams: {
      model: 'cosyvoice-v3-flash',
      voice: 'longxiaochun',
      speed: 1.0,
      pitch: 1.0,
      format: 'mp3',
    },
    availableModels: [
      { id: 'cosyvoice-v3-flash', name: 'CosyVoice V3 Flash (极速超低价)', badge: '极速' },
      { id: 'cosyvoice-v3', name: 'CosyVoice V3 Standard' },
    ],
    voicePresets: [
      { id: 'longxiaochun', name: '龙小淳 (灵动女声)', gender: 'female', tag: '通用' },
      { id: 'longshu', name: '龙舒 (温暖知性)', gender: 'female', tag: '有声书' },
      { id: 'longhaitun', name: '龙海豚 (阳光青年)', gender: 'male', tag: '短视频' },
      { id: 'longfei', name: '龙飞 (新闻播音)', gender: 'male', tag: '播报' },
    ],
    enabled: true,
    isDefault: false,
  },
  {
    id: 'mock-audio-local',
    name: '本地模拟音频 (Mock)',
    category: 'audio',
    driverType: 'mock',
    description: '无需任何 API Key，在本地离线生成正弦波测试音频，用于流转调试。',
    credentials: {},
    sampleParams: {
      model: 'mock-synth-1',
      tone: 'melodic',
      durationSec: 4,
      format: 'wav',
    },
    availableModels: [{ id: 'mock-synth-1', name: 'Mock Synthesizer V1' }],
    voicePresets: [
      { id: 'sine-chime', name: '正弦风铃音' },
      { id: 'beep-pulse', name: '脉冲提示音' },
    ],
    enabled: true,
    isDefault: false,
  },
  {
    id: 'kling-video-default',
    name: '快手可灵 (Kling AI)',
    category: 'video',
    driverType: 'kling',
    description: '电影级视频生成，原生支持复杂运镜与首尾帧控制。',
    credentials: {
      baseUrl: 'https://api.klingai.com/v1',
      apiKey: '',
    },
    sampleParams: {
      duration: '5s',
      ratio: '16:9',
      mode: 'std',
      cameraMotion: 'none',
    },
    availableModels: [
      { id: 'kling-v1', name: 'Kling V1.0', badge: '稳定' },
      { id: 'kling-v1.5', name: 'Kling V1.5 Pro' },
    ],
    enabled: true,
    isDefault: true,
  },
  {
    id: 'fal-video-default',
    name: 'Fal.ai (Luma / Kling / Minimax)',
    category: 'video',
    driverType: 'fal',
    description: 'Fal 聚合视频中转服务，支持各种开源与商业视频生成端点。',
    credentials: {
      baseUrl: 'https://queue.fal.run',
      apiKey: '',
    },
    sampleParams: {
      duration: '5s',
      ratio: '16:9',
    },
    availableModels: [
      { id: 'fal-ai/luma-dream-machine', name: 'Luma Dream Machine' },
      { id: 'fal-ai/minimax-video', name: 'MiniMax Hailuo Video' },
      { id: 'fal-ai/kling-video/v1/standard/text-to-video', name: 'Kling Standard' },
    ],
    enabled: true,
    isDefault: false,
  },
];
