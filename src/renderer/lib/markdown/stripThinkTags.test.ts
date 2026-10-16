import { describe, expect, it } from 'vitest';
import { stripThinkTags } from './stripThinkTags';

describe('stripThinkTags', () => {
  it('returns text without tags untouched', () => {
    expect(stripThinkTags('plain **text**')).toBe('plain **text**');
  });

  it('drops everything up to the last closing tag, even when earlier blocks were never closed', () => {
    const stored = '<think>\n正在检查。\n\n<think>\n我将修复。\n\n<think>\nThe user requested a check.\n</think>\n全文只发现 **1** 处问题。';
    expect(stripThinkTags(stored)).toBe('全文只发现 **1** 处问题。');
  });

  it('hides a block that is still streaming', () => {
    expect(stripThinkTags('先说结论。<think>\n还在想')).toBe('先说结论。');
    expect(stripThinkTags('<think>\n只有推理')).toBe('');
  });

  it('keeps answer text on both sides of a balanced block', () => {
    expect(stripThinkTags('<think>想一想</think>\n答案')).toBe('答案');
  });

  it('leaves tags inside fenced code alone', () => {
    const doc = '用法：\n```html\n<think>x</think>\n```\n完毕';
    expect(stripThinkTags(doc)).toBe(doc);
  });

  it('still strips reasoning around a fence and keeps the fence if it follows the reasoning', () => {
    const text = '<think>想</think>\n```ts\nconst a = 1;\n```\n好了';
    expect(stripThinkTags(text)).toBe('```ts\nconst a = 1;\n```\n好了');
  });
});
