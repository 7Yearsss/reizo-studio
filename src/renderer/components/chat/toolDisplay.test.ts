import { describe, expect, it } from 'vitest';
import { toolDiffPreview } from './toolDisplay';
import type { ToolCallPart } from '../../../shared/chat';

function part(result?: string): ToolCallPart {
  return { type: 'tool', id: 't1', name: 'edit_file', args: { path: 'a.ts' }, result };
}

describe('toolDiffPreview', () => {
  it('returns null when the result has no preview', () => {
    expect(toolDiffPreview(part(JSON.stringify({ path: 'a.ts', diff: '- x\n+ y' })))).toBeNull();
  });

  it('returns null for a running tool with no result', () => {
    expect(toolDiffPreview(part(undefined))).toBeNull();
  });

  it('extracts a well-formed before/after preview', () => {
    const preview = { path: 'a.ts', before: 'const x = 1', after: 'const x = 2' };
    expect(toolDiffPreview(part(JSON.stringify({ replacements: 1, preview })))).toEqual(preview);
  });

  it('ignores a malformed preview object', () => {
    expect(toolDiffPreview(part(JSON.stringify({ preview: { path: 'a.ts', before: 3 } })))).toBeNull();
  });
});
