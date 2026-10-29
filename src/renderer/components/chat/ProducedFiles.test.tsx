// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ToolCallPart } from '../../../shared/chat';
import { producedFilePaths, turnSnapshotIds } from './ProducedFiles';

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

describe('turnSnapshotIds', () => {
  const edit = (id: string, over: Partial<ToolCallPart> = {}): ToolCallPart => ({ type: 'tool', id, name: 'edit_file', args: {}, result: JSON.stringify({ snapshotId: id }), ...over });
  it('lists successful edit snapshots newest first so they undo in order', () => {
    expect(turnSnapshotIds([edit('s1'), edit('s2'), edit('s3', { error: 'denied' }), edit('s4', { name: 'read_file' }), edit('s5', { result: 'not json' })])).toEqual(['s2', 's1']);
  });
});
