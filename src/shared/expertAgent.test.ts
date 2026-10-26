import { describe, expect, it } from 'vitest';
import { expertIdFor, findExpertMention, parseExpert, serializeExpert, type ExpertAgent } from './expertAgent';

const copywriter: ExpertAgent = {
  id: 'wenan', name: '文案专家', aliases: ['copywriter'], description: '写营销文案',
  instructions: '你是资深文案。先问受众，再给三个版本。', model: 'gpt-5', allowedTools: 'read_file, grep', maxTurns: 12,
};
const pm: ExpertAgent = { id: 'pm', name: '产品经理', aliases: [], description: '', instructions: '写 PRD' };

describe('expert files', () => {
  it('round-trips through the file format', () => {
    const parsed = parseExpert(serializeExpert(copywriter), 'wenan')!;
    expect(parsed).toEqual(copywriter);
  });
  it('rejects files without a name or instructions', () => {
    expect(parseExpert('---\nname: x\n---\n', 'x')).toBeNull();
    expect(parseExpert('no frontmatter', 'x')).toBeNull();
    expect(parseExpert('---\ndescription: d\n---\nbody', 'x')).toBeNull();
  });
  it('derives file-safe ids, keeping Chinese', () => {
    expect(expertIdFor('文案 专家!')).toBe('文案-专家');
    expect(expertIdFor('!!!')).toBe('expert');
  });
});

describe('@ routing', () => {
  const experts = [copywriter, pm];
  it('routes a leading @name or @alias', () => {
    expect(findExpertMention('@文案专家 写一段开场白', experts)?.id).toBe('wenan');
    expect(findExpertMention('@文案专家写一段开场白', experts)?.id).toBe('wenan');
    expect(findExpertMention('  @Copywriter, draft a tagline', experts)?.id).toBe('wenan');
    expect(findExpertMention('@产品经理：整理需求', experts)?.id).toBe('pm');
  });
  it('ignores mentions that are not at the start, or not an expert', () => {
    expect(findExpertMention('请 @文案专家 帮忙', experts)).toBeNull();
    expect(findExpertMention('@src/a.ts 这个文件做什么', experts)).toBeNull();
    expect(findExpertMention('@copywriterX hi', experts)).toBeNull();
    expect(findExpertMention('没有提及', experts)).toBeNull();
  });
});
