import { describe, expect, it } from 'vitest';
import { knowledgeFileProblem, looksBinary, OFFICE_FILE, pickFolderFiles } from './knowledgeFiles';

describe('knowledge files', () => {
  it('turns away formats it cannot read, with what to do instead', () => {
    expect(knowledgeFileProblem({ name: '图.png', size: 10 })).toContain('另存为');
    expect(knowledgeFileProblem({ name: '合同.pdf', size: 10 })).toBeNull();
    expect(knowledgeFileProblem({ name: '说明.MD', size: 10 })).toBeNull();
    expect(knowledgeFileProblem({ name: '报告.docx', size: 10 })).toBeNull();
    expect(OFFICE_FILE.test('表.XLSX')).toBe(true);
    expect(knowledgeFileProblem({ name: '旧.doc', size: 10 })).toContain('旧版');
    expect(knowledgeFileProblem({ name: 'a.txt', size: 0 })).toContain('空');
    expect(knowledgeFileProblem({ name: 'a.txt', size: 6 * 1024 * 1024 })).toContain('MB');
  });
  it('spots binary content that slipped through', () => {
    expect(looksBinary('hello\u0000world')).toBe(true);
    expect(looksBinary('�'.repeat(500) + 'x')).toBe(true);
    expect(looksBinary('正常的文字 normal text')).toBe(false);
  });
});

describe('pickFolderFiles', () => {
  const e = (path: string, size = 10) => ({ path, size });
  it('keeps documents and drops hidden, lock, dependency and unsupported files', () => {
    const { picked, skipped, truncated } = pickFolderFiles([
      e('资料/政策.md'), e('资料/价格.xlsx'), e('资料/子目录/说明.PDF'), e('资料/.git/config.txt'), e('资料/~$价格.xlsx'),
      e('资料/node_modules/x/readme.md'), e('资料/logo.png'), e('资料/空.txt', 0), e('资料/.DS_Store'),
    ]);
    expect(picked.map((p) => p.path)).toEqual(['资料/政策.md', '资料/价格.xlsx', '资料/子目录/说明.PDF']);
    expect(skipped).toBe(6);
    expect(truncated).toBe(false);
  });
  it('caps a huge folder and says so', () => {
    const many = Array.from({ length: 260 }, (_, i) => e(`d/f${i}.txt`));
    const out = pickFolderFiles(many);
    expect(out.picked).toHaveLength(200);
    expect(out.truncated).toBe(true);
  });
});
