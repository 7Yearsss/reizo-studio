import { describe, it, expect } from 'vitest';
import { microCompactToolResult, getToolOutputBudget } from './microCompact';

describe('microCompact', () => {
  describe('getToolOutputBudget', () => {
    it('returns specific budgets for known tools', () => {
      expect(getToolOutputBudget('grep')).toBe(3000);
      expect(getToolOutputBudget('read_file')).toBe(6000);
    });

    it('returns default budget for unknown tools', () => {
      expect(getToolOutputBudget('unknown_tool')).toBe(8000);
    });
  });

  describe('microCompactToolResult', () => {
    it('compacts grep results over 15 matches', () => {
      const matches = Array.from({ length: 20 }, (_, i) => ({ line: i }));
      const result = microCompactToolResult('grep', JSON.stringify(matches));
      const parsed = JSON.parse(result);
      
      expect(parsed.length).toBe(16);
      expect(parsed[15].summary).toBe('... and 5 more matches');
    });

    it('does not compact grep results under 15 matches', () => {
      const matches = Array.from({ length: 10 }, (_, i) => ({ line: i }));
      const result = microCompactToolResult('grep', JSON.stringify(matches));
      const parsed = JSON.parse(result);
      
      expect(parsed.length).toBe(10);
    });

    it('compacts find_files results over 20 files', () => {
      const files = Array.from({ length: 25 }, (_, i) => ({ file: `test${i}.ts` }));
      const result = microCompactToolResult('find_files', JSON.stringify(files));
      const parsed = JSON.parse(result);
      
      expect(parsed.length).toBe(21);
      expect(parsed[20].summary).toBe('... and 5 more files');
    });

    it('compacts list_dir results over 30 entries', () => {
      const entries = Array.from({ length: 35 }, (_, i) => ({ name: `dir${i}` }));
      const result = microCompactToolResult('list_dir', JSON.stringify(entries));
      const parsed = JSON.parse(result);
      
      expect(parsed.length).toBe(31);
      expect(parsed[30].summary).toBe('... and 5 more entries');
    });

    it('compacts read_file if content exceeds budget', () => {
      const content = 'a'.repeat(7000); // budget is 6000
      const result = microCompactToolResult('read_file', content);
      
      expect(result.startsWith('a'.repeat(2000))).toBe(true);
      expect(result.endsWith('a'.repeat(500))).toBe(true);
      expect(result).toContain('[... 4500 chars omitted ...]');
    });

    it('does not compact read_file if content is within budget', () => {
      const content = 'a'.repeat(5000); // budget is 6000
      const result = microCompactToolResult('read_file', content);
      
      expect(result).toBe(content);
    });

    it('compacts run_command stdout and stderr if they exceed limits', () => {
      const output = {
        stdout: 'o'.repeat(2500), // exceeds 2000
        stderr: 'e'.repeat(600)   // exceeds 500
      };
      const result = microCompactToolResult('run_command', JSON.stringify(output));
      const parsed = JSON.parse(result);
      
      expect(parsed.stdout.startsWith('o'.repeat(1500))).toBe(true);
      expect(parsed.stdout.endsWith('o'.repeat(500))).toBe(true);
      expect(parsed.stdout).toContain('[... 500 chars omitted ...]');
      
      expect(parsed.stderr.startsWith('e'.repeat(500))).toBe(true);
      expect(parsed.stderr).toContain('[... 100 chars omitted ...]');
    });

    it('falls back to default truncation if JSON parsing fails for run_command', () => {
      const content = 'o'.repeat(5000); // budget is 4000
      const result = microCompactToolResult('run_command', content);
      
      expect(result.length).toBeLessThan(4100); // 4000 + truncation message
      expect(result).toContain('…[truncated 1000 chars]');
    });

    it('falls back to default truncation for unknown tools', () => {
      const content = 'a'.repeat(9000); // default budget is 8000
      const result = microCompactToolResult('unknown_tool', content);
      
      expect(result.length).toBeLessThan(8100);
      expect(result).toContain('…[truncated 1000 chars]');
    });

    it('strips dataUrl from generate_image tool result', () => {
      const toolOutput = JSON.stringify({
        ok: true,
        imageUrl: '/api/canvas/assets/chat/img-123.png',
        dataUrl: 'data:image/png;base64,VERY_LONG_BASE64_STRING_12345',
        prompt: 'a cute cat',
        size: '1024x1024',
      });
      const result = microCompactToolResult('generate_image', toolOutput);
      const parsed = JSON.parse(result);

      expect(parsed.dataUrl).toBeUndefined();
      expect(parsed.imageUrl).toBe('/api/canvas/assets/chat/img-123.png');
      expect(parsed.prompt).toBe('a cute cat');
    });
  });
});
