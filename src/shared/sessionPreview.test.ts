import { describe, expect, it } from 'vitest';
import { previewDelay, previewLines } from './sessionPreview';

describe('previewLines', () => {
  it('takes the last few user/assistant messages in order, skipping tool rows and empties', () => {
    const lines = previewLines([
      { role: 'user', content: '第一个问题' },
      { role: 'tool', content: 'noise' },
      { role: 'assistant', content: '回答一' },
      { role: 'user', content: '   ' },
      { role: 'user', content: '追问' },
      { role: 'assistant', content: '回答二' },
    ], 3);
    expect(lines.map((l) => l.text)).toEqual(['回答一', '追问', '回答二']);
    expect(lines[0].role).toBe('assistant');
  });
  it('flattens code blocks and shortens long text', () => {
    const [line] = previewLines([{ role: 'assistant', content: `前文\n\`\`\`js\nconsole.log(1)\n\`\`\`\n${'长'.repeat(300)}` }], 1, 50);
    expect(line.text).not.toContain('console.log');
    expect(line.text).toContain('[代码]');
    expect(line.text.length).toBeLessThanOrEqual(51);
  });
  it('is empty for an empty conversation', () => {
    expect(previewLines([])).toEqual([]);
  });
});

describe('previewDelay', () => {
  it('waits the first time and switches instantly while warm', () => {
    expect(previewDelay(null, 1000)).toBe(450);
    expect(previewDelay(900, 1000)).toBe(0);
    expect(previewDelay(100, 1000)).toBe(450);
  });
});
