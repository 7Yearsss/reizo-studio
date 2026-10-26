import { describe, expect, it } from 'vitest';
import { searchTools } from './toolSearch';

const tool = (name: string, server: string, description: string) => ({ name, server, description });
const tools = [
  tool('mcp__files__read_file', 'files', 'Read a file from disk'),
  tool('mcp__files__write_file', 'files', 'Write a file to disk'),
  tool('mcp__calendar__create_event', 'calendar', 'Create a calendar event with attendees'),
  tool('mcp__mail__send', 'mail', '发送一封邮件给收件人'),
];

describe('searchTools', () => {
  it('ranks name hits above description hits and returns nothing for no match', () => {
    expect(searchTools(tools, 'calendar event').map((t) => t.name)[0]).toBe('mcp__calendar__create_event');
    expect(searchTools(tools, 'zzzz')).toEqual([]);
    expect(searchTools(tools, '')).toEqual([]);
  });
  it('finds Chinese descriptions by two-character windows', () => {
    expect(searchTools(tools, '发送邮件').map((t) => t.name)).toContain('mcp__mail__send');
  });
  it('honours the limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => tool(`mcp__s__tool_${i}`, 's', 'does a thing'));
    expect(searchTools(many, 'thing', 8)).toHaveLength(8);
  });
});
