import type { AudioDriver, AudioDriverCredentials, AudioGenerateParams, AudioJobResult } from './types';

function generateWavBuffer(durationSec: number = 3, freq: number = 440): Buffer {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2; // 16-bit mono = 2 bytes per sample
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(1, 22); // NumChannels (1 = Mono)
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  buffer.writeUInt16LE(2, 32); // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Generate a pleasant pentatonic chime (440Hz, 554Hz, 659Hz arpeggiated with decay)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Harmonic chime chord with exponential decay envelope
    const env = Math.exp(-1.5 * (t % 1.0));
    const tone =
      0.6 * Math.sin(2 * Math.PI * freq * t) +
      0.3 * Math.sin(2 * Math.PI * (freq * 1.25) * t) +
      0.1 * Math.sin(2 * Math.PI * (freq * 1.5) * t);
    const sample = Math.max(-1, Math.min(1, tone * env));
    const intSample = Math.floor(sample * 32767);
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

export const mockAudioDriver: AudioDriver = {
  id: 'mock',
  name: '本地模拟音频驱动',
  async synthesize(params: AudioGenerateParams, _credentials: AudioDriverCredentials): Promise<AudioJobResult> {
    const duration = params.pitch ? Math.max(1, Math.min(10, 3 + params.pitch * 0.2)) : 3;
    const freq = params.voiceId === 'beep-pulse' ? 880 : 440;
    const wav = generateWavBuffer(duration, freq);
    return {
      audioBuffer: wav,
      format: 'wav',
      durationSec: duration,
    };
  },
};
