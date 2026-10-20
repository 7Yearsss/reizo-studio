import { describe, expect, it } from 'vitest';
import { createDocumentContent, documentSchema, normalizeDocumentContent } from './documentContent';
import { applyFormat, classifyBlocks, OFFICIAL_SPEC, specFromContent, THESIS_SPEC } from './documentFormat';

const para = (text: string, attrs: Record<string, unknown> = {}, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({ type: 'paragraph', attrs, content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
const doc = (...nodes: ReturnType<typeof para>[]) => createDocumentContent({ type: 'doc', content: nodes });

describe('classifyBlocks', () => {
  it('finds the title, numbered headings at four levels, body, and leaves the closing date alone', () => {
    const nodes = [
      para('关于加强安全生产工作的通知'), para('各部门：'), para('一、总体要求'), para('（一）基本原则'), para('1. 坚持预防为主'), para('（1）落实责任'),
      para('各单位要认真落实各项安全生产措施，确保全年无事故。'), para('2025年3月1日'),
    ];
    expect(classifyBlocks(nodes.map((n) => JSON.parse(JSON.stringify(n))))).toEqual(['title', 'body', 'heading1', 'heading2', 'heading3', 'heading4', 'body', null]);
  });

  it('treats decimal headings, chapter headings and sentences correctly', () => {
    const roles = classifyBlocks([para('毕业论文题目'), para('第一章 绪论'), para('1.1 研究背景'), para('1.1.1 国内现状'), para('1. 这是一句很长的话，它以句号结尾，所以应当是正文而不是标题。')]);
    expect(roles).toEqual(['title', 'heading1', 'heading2', 'heading3', 'body']);
  });

  it('leaves lists, tables and empty lines untouched', () => {
    const roles = classifyBlocks([{ type: 'bulletList', content: [] }, { type: 'table', content: [] }, para('  '), para('正文一段。')]);
    expect(roles).toEqual([null, null, null, 'body']);
  });
});

describe('applyFormat', () => {
  const source = doc(
    para('通知', { textAlign: 'left' }, [{ type: 'runStyle', attrs: { color: 'ff0000', size: 10, font: 'Arial', highlight: null, vert: null } }, { type: 'bold' }]),
    para('一、目的', {}),
    para('按规定执行本次工作。', { indentFirst: 100, indentLeft: 300, lineSpacing: 1.2 }, [{ type: 'italic' }]),
  );

  it('sets font, size, colour, alignment, indent and fixed line height by role, keeping other marks', () => {
    const { content, counts, changed } = applyFormat(source, OFFICIAL_SPEC);
    expect(counts).toEqual({ title: 1, heading1: 1, body: 1 });
    expect(changed).toBe(3);
    const [title, heading, body] = content.doc.content!;
    expect(title.attrs).toMatchObject({ textAlign: 'center', indentFirst: null, lineExact: 35, spaceAfter: 560 });
    expect(title.content![0].marks).toEqual([{ type: 'runStyle', attrs: { color: '000000', size: 22, font: OFFICIAL_SPEC.roles.title.font, highlight: null, vert: null } }]);
    expect(heading.content![0].marks![0].attrs).toMatchObject({ font: '黑体,SimHei,黑体', size: 16 });
    expect(body.attrs).toMatchObject({ textAlign: 'justify', indentFirst: 640, indentLeft: null, lineExact: 28, lineSpacing: null });
    expect(body.content![0].marks).toEqual(expect.arrayContaining([{ type: 'italic' }]));
    expect(body.content![0].text).toBe('按规定执行本次工作。');
    // The result is a valid document and the source object is untouched.
    expect(() => normalizeDocumentContent(JSON.parse(JSON.stringify(content)))).not.toThrow();
    expect(() => documentSchema.nodeFromJSON(content.doc).check()).not.toThrow();
    expect(source.doc.content![2].attrs).toMatchObject({ indentFirst: 100, indentLeft: 300 });
  });

  it('uses a line-height multiple for a layout that has no fixed height, and reports nothing changed when run twice', () => {
    const once = applyFormat(source, THESIS_SPEC);
    expect(once.content.doc.content![2].attrs).toMatchObject({ lineExact: null, lineSpacing: 1.5, indentFirst: 480 });
    expect(applyFormat(once.content, THESIS_SPEC).changed).toBe(0);
  });
});

describe('specFromContent', () => {
  it('learns each role\'s layout from a reference document', () => {
    const run = (font: string, size: number): { type: string; attrs: Record<string, unknown> }[] => [{ type: 'runStyle', attrs: { color: null, size, font, highlight: null, vert: null } }];
    const reference = doc(
      para('范文标题', { textAlign: 'center', lineExact: 30 }, run('华文中宋', 20)),
      para('一、第一部分', {}, [...run('黑体', 15), { type: 'bold' }]),
      para('这是范文里的正文，字号小四。', { indentFirst: 480, lineSpacing: 1.5, textAlign: 'justify' }, run('宋体', 12)),
      para('这是范文里的另一段正文，同样的版式。', { indentFirst: 480, lineSpacing: 1.5, textAlign: 'justify' }, run('宋体', 12)),
    );
    const spec = specFromContent(reference, '范文.docx');
    expect(spec.name).toBe('范文.docx');
    expect(spec.roles.title).toMatchObject({ font: '华文中宋', size: 20, align: 'center', lineExact: 30 });
    expect(spec.roles.heading1).toMatchObject({ font: '黑体', size: 15, bold: true });
    expect(spec.roles.body).toMatchObject({ font: '宋体', size: 12, align: 'justify', firstLineChars: 2, lineMultiple: 1.5 });
    // A role the reference never uses falls back sensibly and keeps the reference's body font.
    expect(spec.roles.heading3.font).toBe('宋体');
  });
});
