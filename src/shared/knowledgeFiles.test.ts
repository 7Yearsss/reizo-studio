import { describe, expect, it } from 'vitest';
import { knowledgeFileProblem, looksBinary } from './knowledgeFiles';

describe('knowledge files', () => {
  it('turns away formats it cannot read, with what to do instead', () => {
    expect(knowledgeFileProblem({ name: '合同.pdf', size: 10 })).toContain('另存为');
    expect(knowledgeFileProblem({ name: '说明.MD', size: 10 })).toBeNull();
    expect(knowledgeFileProblem({ name: 'a.txt', size: 0 })).toContain('空');
    expect(knowledgeFileProblem({ name: 'a.txt', size: 6 * 1024 * 1024 })).toContain('MB');
  });
  it('spots binary content that slipped through', () => {
    expect(looksBinary('hello\u0000world')).toBe(true);
    expect(looksBinary('�'.repeat(500) + 'x')).toBe(true);
    expect(looksBinary('正常的文字 normal text')).toBe(false);
  });
});
