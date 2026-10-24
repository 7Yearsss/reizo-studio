// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ToolCallPart } from '../../../shared/chat';
import { producedFilePaths } from './ProducedFiles';

describe('produced file links', () => {
  const part = (overrides: Partial<ToolCallPart> = {}): ToolCallPart => ({ type: 'tool', id: 'write', name: 'write_file', args: { path: 'out/share.md' }, result: '{"path":"out/share.md"}', ...overrides });
  it('deduplicates confirmed outputs and omits pending, failed and read-only tools', () => {
    expect(producedFilePaths([part(), part({ name: 'edit_file' }), part({ result: undefined }),
      part({ error: 'denied' }), part({ result: '{"ok":false}' }), part({ name: 'read_file' })])).toEqual(['out/share.md']);
  });
  it('does not turn arbitrary shell logs into promised deliverables', () => {
    expect(producedFilePaths([part({ name: 'run_command', result: 'Saved out/movie.mp4' })])).toEqual([]);
  });
});
