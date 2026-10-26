import { describe, expect, it } from 'vitest';
import type { Session } from './chat';
import { buildSessionExport, redactForShare, sessionToMarkdown } from './sessionExport';

const KEY = 'sk-' + 'a'.repeat(30);

const session = {
  id: 's', title: 'fix in C:\\Users\\alice\\proj', workspacePath: 'C:\\work\\shop',
  messages: [
    { id: '1', role: 'user', content: `key ${KEY} file C:\\work\\shop\\src\\a.ts mail bob@example.com`, createdAt: 't' },
    { id: '2', role: 'assistant', content: 'ok /home/carol/x', reasoning: 'secret thoughts', createdAt: 't', parts: [{ name: 'read_file', input: { path: 'C:\\work\\shop\\a.ts' } }] },
    { id: '3', role: 'user', content: 'rewound', rewindAt: 'x', createdAt: 't' },
  ],
} as unknown as Session;

describe('redactForShare', () => {
  it('replaces secrets, workspace and home paths and emails, with counts', () => {
    const { text, stats } = redactForShare(`${KEY} C:\\work\\shop\\src\\a.ts /home/carol/x bob@example.com`, { workspacePath: 'C:\\work\\shop' });
    expect(text).not.toContain(KEY);
    expect(text).toContain('<workspace>');
    expect(text).toContain('<home>');
    expect(text).toContain('<email>');
    expect(text).not.toContain('carol');
    expect(stats).toEqual({ secrets: 1, paths: 2, emails: 1 });
  });

  it('matches the workspace with either slash style', () => {
    expect(redactForShare('C:/work/shop/a.ts', { workspacePath: 'C:\\work\\shop' }).text).toBe('<workspace>/a.ts');
  });
});

describe('buildSessionExport', () => {
  it('full keeps redacted text, drops rewound rows and reasoning', () => {
    const out = buildSessionExport(session, 'full');
    const json = JSON.stringify(out);
    expect(out.messages).toHaveLength(2);
    expect(json).not.toContain(KEY);
    expect(json).not.toContain('alice');
    expect(json).not.toContain('secret thoughts');
    expect(json).not.toContain('shop');
    expect(out.stats.secrets).toBeGreaterThan(0);
  });
  it('structure replaces prose with placeholders but keeps tool parts', () => {
    const out = buildSessionExport(session, 'structure');
    expect(out.messages[0].content).toMatch(/^\[user text omitted, \d+ chars\]$/);
    expect(out.messages[1].parts).toHaveLength(1);
  });
  it('renders markdown', () => {
    const out = buildSessionExport(session, 'full');
    expect(sessionToMarkdown(out.title, out.messages)).toContain('## user');
  });
});
