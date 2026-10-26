import { describe, expect, it } from 'vitest';
import { classifyConsequence } from './computerConsequence';

const click = (extra: Record<string, unknown> = {}) => ({ action: 'left_click', x: 1, y: 1, ...extra }) as never;

describe('computer consequence classification', () => {
  it('declared categories always count; "none" is trusted', () => {
    expect(classifyConsequence(click({ consequence: 'send' }))).toBe('send');
    expect(classifyConsequence(click({ consequence: 'none', summary: '点击发送按钮' }))).toBeNull();
  });
  it('catches undeclared send / pay / delete wording in the summary, Chinese and English', () => {
    expect(classifyConsequence(click({ summary: '点击「发送」按钮发出邮件' }))).toBe('send');
    expect(classifyConsequence(click({ summary: 'Click Place order' }))).toBe('purchase');
    expect(classifyConsequence(click({ summary: '确认支付' }))).toBe('purchase');
    expect(classifyConsequence(click({ summary: '删除所选文件' }))).toBe('delete');
    expect(classifyConsequence(click({ summary: 'Click Publish to go live' }))).toBe('publish');
    expect(classifyConsequence(click({ summary: '覆盖原文件' }))).toBe('overwrite');
  });
  it('ordinary navigation and looking never need confirmation', () => {
    expect(classifyConsequence(click({ summary: '打开文件菜单' }))).toBeNull();
    expect(classifyConsequence({ action: 'screenshot' })).toBeNull();
    expect(classifyConsequence({ action: 'scroll', direction: 'down' } as never)).toBeNull();
    expect(classifyConsequence({ action: 'move', x: 1, y: 2 })).toBeNull();
  });
  it('typing the word "send" or "delete" into a document is not a consequence', () => {
    expect(classifyConsequence({ action: 'type', text: '请发送报告并删除旧版本，format the cells' })).toBeNull();
  });
});
