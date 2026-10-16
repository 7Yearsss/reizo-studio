import { VOICE_MAX_SECONDS, VOICE_SAMPLE_RATE } from '../../../shared/voiceInput';

export class VoiceRecording {
  private recorder: MediaRecorder;
  private context: AudioContext;
  private analyser: AnalyserNode;
  private chunks: Blob[] = [];
  private cancelled = false;
  private stopped: Promise<void>;
  constructor(private stream: MediaStream) {
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.context = new AudioContext();
    try {
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      this.context.createMediaStreamSource(stream).connect(this.analyser);
    } catch (error) { void this.context.close().catch((): void => undefined); throw error; }
    this.stopped = new Promise((resolve, reject) => {
      this.recorder.ondataavailable = event => { if (event.data.size && !this.cancelled) this.chunks.push(event.data); };
      this.recorder.onstop = () => resolve();
      this.recorder.onerror = () => reject(new Error('录音设备中断，请检查麦克风后重试'));
    });
    // An error before stop still reaches finish(), without an unhandled rejection.
    void this.stopped.catch((): void => undefined);
  }
  async start() { await this.context.resume(); if (!this.cancelled) this.recorder.start(250); }
  level() {
    const data = new Float32Array(this.analyser.fftSize); this.analyser.getFloatTimeDomainData(data);
    return Math.min(1, Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length) * 12);
  }
  private stop() {
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    this.stream.getTracks().forEach(track => track.stop());
  }
  async finish(): Promise<Float32Array> {
    this.stop();
    try {
      await this.stopped;
      const encoded = await new Blob(this.chunks, { type: this.recorder.mimeType }).arrayBuffer();
      if (this.cancelled) throw new DOMException('Cancelled', 'AbortError');
      const decoded = await this.context.decodeAudioData(encoded);
      const count = Math.min(Math.round(decoded.duration * VOICE_SAMPLE_RATE), VOICE_MAX_SECONDS * VOICE_SAMPLE_RATE);
      if (!count) throw new Error('录音时间太短，请重试');
      const offline = new OfflineAudioContext(1, count, VOICE_SAMPLE_RATE);
      const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
      return (await offline.startRendering()).getChannelData(0).slice();
    } finally { this.chunks = []; if (this.context.state !== 'closed') await this.context.close(); }
  }
  cancel() { this.cancelled = true; this.stop(); this.chunks = []; void this.context.close().catch((): void => undefined); }
}

export async function requestVoiceRecording(signal: AbortSignal): Promise<VoiceRecording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('当前环境不支持麦克风录音，请使用桌面客户端');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
  if (signal.aborted) { stream.getTracks().forEach(track => track.stop()); throw new DOMException('Cancelled', 'AbortError'); }
  try { return new VoiceRecording(stream); }
  catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
}
