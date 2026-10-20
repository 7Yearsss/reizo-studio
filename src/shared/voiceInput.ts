export const VOICE_MODEL = 'onnx-community/whisper-base_timestamped';
export const VOICE_REVISION = '608c49e61301901684bc36cac8f74b95ff6b5a8e';
export const VOICE_SAMPLE_RATE = 16_000;
export const VOICE_MAX_SECONDS = 120;
export const VOICE_FILES = [
  ['config.json', 2243, 'f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b'],
  ['generation_config.json', 3832, '61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0'],
  ['preprocessor_config.json', 339, 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d'],
  ['tokenizer.json', 2480466, '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566'],
  ['tokenizer_config.json', 282682, '2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573'],
  ['onnx/encoder_model_quantized.onnx', 23159167, '2714484ebe1bae7c1646e8eadb768bb9d415cf11763466d21f23039a29c62e6f'],
  ['onnx/decoder_model_merged_quantized.onnx', 53712708, 'cf9a8d5bcddc0917a0078135b484cedcaf44f28909cd91910abd29dced9171db'],
] as const;
export const VOICE_MODEL_BYTES = VOICE_FILES.reduce((sum, [, bytes]) => sum + bytes, 0);
export interface VoiceModelStatus { ready: boolean; downloading: boolean; bytes: number; total: number; error?: string }
export type VoiceWorkerRequest = { type: 'load'; origin: string } | { type: 'transcribe'; samples: Float32Array; language: 'zh' | 'en' };
export type VoiceWorkerReply = { type: 'ready' } | { type: 'result'; text: string } | { type: 'error'; message: string };

export function appendVoiceText(draft: string, transcript: string): string {
  const text = transcript.trim();
  if (!text) return draft;
  return draft + (draft && !/\s$/.test(draft) ? '\n' : '') + text;
}

/** Reject near-silence before Whisper can hallucinate a transcript. */
export function hasVoiceEnergy(samples: Float32Array): boolean {
  if (samples.length < VOICE_SAMPLE_RATE / 4 || samples.length > VOICE_SAMPLE_RATE * VOICE_MAX_SECONDS) return false;
  let audibleFrames = 0;
  for (let start = 0; start < samples.length; start += 320) {
    let energy = 0;
    const end = Math.min(start + 320, samples.length);
    for (let i = start; i < end; i++) { if (!Number.isFinite(samples[i])) return false; energy += samples[i] ** 2; }
    if (Math.sqrt(energy / (end - start)) > 0.003) audibleFrames++;
  }
  return audibleFrames >= 8;
}
