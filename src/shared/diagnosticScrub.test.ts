import { describe, expect, it } from 'vitest';
import { scrubString, scrubValue } from './diagnosticScrub';

const KEY = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';
const PNG = `data:image/png;base64,${'A'.repeat(4000)}`;

describe('diagnostic scrub', () => {
  it('leaves no plaintext key, image bytes or password anywhere in a nested session', () => {
    const session = {
      providers: { openai: { apiKey: KEY, baseUrl: 'https://api.test', headers: { Authorization: `Bearer ${KEY}` } } },
      messages: [
        { role: 'user', content: `my key is ${KEY} and here is a picture ${PNG}` },
        { role: 'assistant', toolCalls: [{ name: 'browser_fill', input: { selector: '#pwd', password: 'hunter2hunter2' }, output: `ok ${KEY}` }] },
      ],
      env: { GITHUB_TOKEN: 'ghp_' + 'a'.repeat(40), note: 'AWS_SECRET_ACCESS_KEY=abcdefgh12345678' },
    };
    const json = JSON.stringify(scrubValue(session));
    for (const secret of [KEY, 'hunter2hunter2', 'ghp_' + 'a'.repeat(40), 'abcdefgh12345678', 'A'.repeat(300)]) expect(json).not.toContain(secret);
    expect(json).toContain('[image: 3KB png]');
    expect(json).toContain('https://api.test');
  });

  it('keeps non-secret values and booleans readable', () => {
    expect(scrubValue({ hasKey: true, tokenCount: 0, model: 'gpt-4o', apiKey: '' })).toEqual({ hasKey: true, tokenCount: 0, model: 'gpt-4o', apiKey: '' });
  });

  it('cuts very long text and bare base64 blobs', () => {
    expect(scrubString('hello, world. '.repeat(500))).toContain('chars cut');
    expect(scrubString('QUJD'.repeat(1000))).toMatch(/^\[binary: \d+KB\]$/);
  });

  it('stops at absurd depth instead of recursing forever', () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 30; i += 1) { deep.next = {}; deep = deep.next as Record<string, unknown>; }
    expect(JSON.stringify(scrubValue(root))).toContain('[too deep]');
  });
});
