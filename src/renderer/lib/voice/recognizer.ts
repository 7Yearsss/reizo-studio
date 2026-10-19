import type { VoiceWorkerReply, VoiceWorkerRequest } from '../../../shared/voiceInput';

/** A session owns its worker; cancel terminates inference and frees model memory. */
export class LocalRecognizer {
  private worker = new Worker(new URL('./recognition.worker.ts', import.meta.url), { type: 'module' });
  private cancelRequest?: () => void;
  private request(message: VoiceWorkerRequest, signal: AbortSignal): Promise<VoiceWorkerReply> {
    if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('本地语音处理超时，请取消后重试')), 180_000);
      const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
      const finish = (error?: Error, result?: VoiceWorkerReply) => {
        clearTimeout(timer); signal.removeEventListener('abort', abort); this.cancelRequest = undefined;
        this.worker.onmessage = null; this.worker.onerror = null;
        if (error) { this.worker.terminate(); reject(error); } else if (result) resolve(result);
      };
      signal.addEventListener('abort', abort, { once: true });
      this.cancelRequest = abort;
      this.worker.onmessage = (event: MessageEvent<VoiceWorkerReply>) => {
        if (event.data.type === 'error') finish(new Error(event.data.message)); else finish(undefined, event.data);
      };
      this.worker.onerror = () => finish(new Error('语音运行环境加载失败，请重启应用后重试'));
      this.worker.postMessage(message, message.type === 'transcribe' ? [message.samples.buffer] : []);
    });
  }
  async load(origin: string, signal: AbortSignal) { await this.request({ type: 'load', origin }, signal); }
  async transcribe(samples: Float32Array, language: 'zh' | 'en', signal: AbortSignal) {
    const result = await this.request({ type: 'transcribe', samples, language }, signal);
    return result.type === 'result' ? result.text : '';
  }
  dispose() { this.cancelRequest?.(); this.worker.terminate(); }
}
