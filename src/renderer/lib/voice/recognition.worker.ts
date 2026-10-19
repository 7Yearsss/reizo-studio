import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { Converter } from 'opencc-js/t2cn';
import { VOICE_MODEL, VOICE_MAX_SECONDS, VOICE_SAMPLE_RATE, type VoiceWorkerRequest, type VoiceWorkerReply } from '../../../shared/voiceInput';

let recognizer: AutomaticSpeechRecognitionPipeline | undefined;
const simplifiedChinese = Converter({ from: 'tw', to: 'cn' });
const reply = (message: VoiceWorkerReply) => self.postMessage(message);
// Use the library's HTTP loader against loopback only (not the public Hub).
env.allowRemoteModels = true;
env.allowLocalModels = false;
env.useBrowserCache = false;
env.useFSCache = false;
self.onmessage = async (event: MessageEvent<VoiceWorkerRequest>) => {
  try {
    if (event.data.type === 'load') {
      const origin = new URL(event.data.origin);
      if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') throw new Error('语音服务地址无效');
      env.remoteHost = `${origin.origin}/api/voice/models/`;
      env.remotePathTemplate = '{model}/';
      env.fetch = (input, init) => {
        const url = new URL(input);
        if (url.origin !== origin.origin || !url.pathname.startsWith('/api/voice/') || (init?.method && !['GET', 'HEAD'].includes(init.method))) throw new Error('语音模型仅允许从本机读取');
        return fetch(input, init);
      };
      env.backends.onnx.wasm.wasmPaths = {
        mjs: `${origin.origin}/api/voice/runtime/ort-wasm-simd-threaded.asyncify.mjs`,
        wasm: `${origin.origin}/api/voice/runtime/ort-wasm-simd-threaded.asyncify.wasm`,
      };
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
      recognizer = await pipeline('automatic-speech-recognition', VOICE_MODEL, {
        device: 'wasm', dtype: 'q8',
        // ORT's extended QDQ rewrite rejects the pinned merged decoder weights.
        session_options: { graphOptimizationLevel: 'basic' },
      });
      reply({ type: 'ready' });
    } else {
      const { samples, language } = event.data;
      if (!recognizer || !(samples instanceof Float32Array) || !samples.length || samples.length > VOICE_MAX_SECONDS * VOICE_SAMPLE_RATE) throw new Error('录音数据无效');
      const result = await recognizer(samples, { language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: false });
      const text = (Array.isArray(result) ? result.map(item => item.text).join(' ') : result.text).trim();
      reply({ type: 'result', text: language === 'zh' ? simplifiedChinese(text) : text });
    }
  } catch (error) {
    if (import.meta.env.DEV) console.error('Local voice engine:', error);
    reply({ type: 'error', message: '本地语音识别失败，请取消后重试。若仍失败，请重启应用。' });
  }
};
