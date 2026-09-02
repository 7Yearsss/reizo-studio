import { describe, expect, it } from 'vitest';
import { plainTextTerminalEnv, stripTerminalControlSequences } from './terminalOutput';

const ESC = '\x1b';

describe('stripTerminalControlSequences', () => {
  it('returns plain text unchanged', () => {
    const s = 'hello world\nsecond line\twith tab';
    expect(stripTerminalControlSequences(s)).toBe(s);
  });

  it('strips SGR colour codes', () => {
    expect(stripTerminalControlSequences(`${ESC}[31mred${ESC}[0m text`)).toBe('red text');
  });

  it('strips a cursor-move CSI', () => {
    expect(stripTerminalControlSequences(`a${ESC}[2Kb${ESC}[1;1Hc`)).toBe('abc');
  });

  it('strips an OSC title sequence terminated by BEL', () => {
    expect(stripTerminalControlSequences(`${ESC}]0;My Title\x07done`)).toBe('done');
  });

  it('strips an OSC sequence terminated by ST', () => {
    expect(stripTerminalControlSequences(`${ESC}]8;;http://x${ESC}\\link`)).toBe('link');
  });

  it('normalises CRLF and lone CR to LF', () => {
    expect(stripTerminalControlSequences('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('drops non-newline C0 controls', () => {
    expect(stripTerminalControlSequences('a\x00b\x07c')).toBe('abc');
  });
});

describe('plainTextTerminalEnv', () => {
  it('sets the known no-colour vars', () => {
    const env = plainTextTerminalEnv();
    expect(env.NO_COLOR).toBe('1');
    expect(env.TERM).toBe('dumb');
    expect(env.PSStyle__OutputRendering).toBe('PlainText');
  });
});
