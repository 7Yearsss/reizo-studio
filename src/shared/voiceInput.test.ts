import { expect, it } from 'vitest';
import { appendVoiceText, hasVoiceEnergy, VOICE_SAMPLE_RATE } from './voiceInput';

it('preserves edited drafts and ignores empty transcripts', () => {
  expect(appendVoiceText('原有草稿', ' 语音内容 ')).toBe('原有草稿\n语音内容');
  expect(appendVoiceText('原有草稿\n', '语音内容')).toBe('原有草稿\n语音内容');
  expect(appendVoiceText('', ' 语音内容 ')).toBe('语音内容');
  expect(appendVoiceText('原有草稿', ' ')).toBe('原有草稿');
});
it('rejects silence, short clicks and invalid samples, accepts sustained audio', () => {
  expect(hasVoiceEnergy(new Float32Array(VOICE_SAMPLE_RATE))).toBe(false);
  const click = new Float32Array(VOICE_SAMPLE_RATE); click[1] = 1;
  expect(hasVoiceEnergy(click)).toBe(false);
  const audio = Float32Array.from({ length: VOICE_SAMPLE_RATE }, (_, i) => Math.sin(i / 10) * 0.1);
  expect(hasVoiceEnergy(audio)).toBe(true);
  audio[0] = NaN; expect(hasVoiceEnergy(audio)).toBe(false);
});
