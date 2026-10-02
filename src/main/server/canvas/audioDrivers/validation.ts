import type { AudioJobResult } from './types';

export function audioProviderMessage(value: unknown, apiKey?: string): string {
  const message = String(value ?? '');
  return (apiKey ? message.split(apiKey).join('[redacted]') : message).slice(0, 500);
}

export function audioFormat(value: unknown): AudioJobResult['format'] {
  if (value !== 'mp3' && value !== 'wav') throw new Error('Audio format must be mp3 or wav');
  return value;
}

/** Validate the actual container instead of assigning an extension to arbitrary or empty bytes. */
export function audioResult(buffer: Buffer, expectedFormat: unknown, declaredFormat?: unknown): AudioJobResult {
  const expected = audioFormat(expectedFormat);
  const declared = declaredFormat === undefined ? undefined : audioFormat(declaredFormat);
  if (!buffer?.byteLength) throw new Error('Audio provider returned empty audio data');
  let detected: AudioJobResult['format'] | undefined;
  if (buffer.length >= 44 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') {
    for (let offset = 12; offset + 8 <= buffer.length;) {
      const size = buffer.readUInt32LE(offset + 4);
      if (buffer.toString('ascii', offset, offset + 4) === 'data' && size > 0 && offset + 8 + size <= buffer.length) { detected = 'wav'; break; }
      offset += 8 + size + (size % 2);
    }
  } else {
    let offset = 0;
    if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'ID3') {
      if ([6, 7, 8, 9].some((index) => buffer[index] >= 128)) throw new Error('Audio provider returned invalid MP3 metadata');
      const tagSize = (buffer[6] << 21) | (buffer[7] << 14) | (buffer[8] << 7) | buffer[9];
      offset = 10 + tagSize + (buffer[5] & 0x10 ? 10 : 0);
    }
    if (offset + 4 <= buffer.length && buffer[offset] === 0xff && (buffer[offset + 1] & 0xe0) === 0xe0 &&
        (buffer[offset + 1] & 6) !== 0 && (buffer[offset + 2] >> 4) !== 15 && (buffer[offset + 2] >> 4) !== 0 &&
        (buffer[offset + 2] & 12) !== 12) detected = 'mp3';
  }
  if (!detected) throw new Error('Audio provider returned an invalid or unsupported audio container');
  if (detected !== expected || (declared && detected !== declared)) throw new Error('Audio provider returned a different format than requested');
  return { audioBuffer: buffer, format: detected };
}

export function formatFromContentType(value: string): AudioJobResult['format'] | undefined {
  const mime = value.split(';')[0].trim().toLowerCase();
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') return 'mp3';
  if (mime === 'audio/wav' || mime === 'audio/x-wav' || mime === 'audio/wave') return 'wav';
  if (mime === 'application/octet-stream' || !mime) return undefined;
  if (mime.startsWith('audio/')) throw new Error(`Unsupported audio response type: ${mime}`);
  return undefined;
}

export function audioProviderBase(value: string): string {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.hash || url.search) throw new Error('Invalid audio provider endpoint');
  return url.href.replace(/\/+$/, '');
}
