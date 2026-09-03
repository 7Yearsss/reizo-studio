import { describe, expect, it } from 'vitest';
import { isCanvasTool, trailEntryFromTool, UNDOABLE_TRAIL_VERBS } from './agentTrail';

const base = { id: 'tc_1', args: {} as Record<string, unknown> };

describe('isCanvasTool', () => {
  it('covers writes and reads, excludes non-canvas tools', () => {
    expect(isCanvasTool('add_node')).toBe(true);
    expect(isCanvasTool('create_storyboard_pipeline')).toBe(true);
    expect(isCanvasTool('read_canvas')).toBe(true);
    expect(isCanvasTool('run_command')).toBe(false);
  });
});

describe('trailEntryFromTool', () => {
  it('returns null for non-canvas tools and for reads', () => {
    expect(trailEntryFromTool({ ...base, name: 'run_command' })).toBeNull();
    expect(trailEntryFromTool({ ...base, name: 'read_canvas', result: '{}' })).toBeNull();
    expect(trailEntryFromTool({ ...base, name: 'read_node', result: '{}' })).toBeNull();
  });

  it('add_node — nodeIds from result.id', () => {
    const e = trailEntryFromTool({
      ...base,
      name: 'add_node',
      args: { type: 'image' },
      result: JSON.stringify({ id: 'n_1', type: 'image' }),
    });
    expect(e).toMatchObject({ verb: 'add', nodeIds: ['n_1'], status: 'done' });
    expect(e?.label).toContain('image');
  });

  it('running (no result yet) → status running, no nodeId', () => {
    const e = trailEntryFromTool({ ...base, name: 'add_node', args: { type: 'image' } });
    expect(e?.status).toBe('running');
    expect(e?.nodeIds).toEqual([]);
  });

  it('create_storyboard_pipeline — note + createdNodeIds', () => {
    const e = trailEntryFromTool({
      ...base,
      name: 'create_storyboard_pipeline',
      result: JSON.stringify({ noteId: 'note_1', createdNodeIds: ['a', 'b', 'c'] }),
    });
    expect(e?.nodeIds).toEqual(['note_1', 'a', 'b', 'c']);
    expect(e?.label).toBe('编排 4 个节点');
    expect(e?.verb).toBe('orchestrate');
  });

  it('connect_nodes — source + target from args', () => {
    const e = trailEntryFromTool({
      ...base,
      name: 'connect_nodes',
      args: { source: 's', target: 't' },
      result: JSON.stringify({ edgeId: 'e1' }),
    });
    expect(e?.nodeIds).toEqual(['s', 't']);
    expect(e?.verb).toBe('connect');
  });

  it('attach_reference — anchor + targets from args', () => {
    const e = trailEntryFromTool({
      ...base,
      name: 'attach_reference',
      args: { anchorId: 'anc', targetIds: ['x', 'y'] },
      result: JSON.stringify({ attached: 2 }),
    });
    expect(e?.nodeIds).toEqual(['anc', 'x', 'y']);
    expect(e?.label).toBe('挂参考到 2 个节点');
  });

  it('group_nodes — group id + members from result', () => {
    const e = trailEntryFromTool({
      ...base,
      name: 'group_nodes',
      result: JSON.stringify({ id: 'g1', memberIds: ['m1', 'm2'] }),
    });
    expect(e?.nodeIds).toEqual(['g1', 'm1', 'm2']);
  });

  it('run_graph — nodeIds whitelist, else from, else empty', () => {
    expect(trailEntryFromTool({ ...base, name: 'run_graph', args: { nodeIds: ['p', 'q'] }, result: '{}' })?.nodeIds).toEqual(['p', 'q']);
    expect(trailEntryFromTool({ ...base, name: 'run_graph', args: { from: 'f' }, result: '{}' })?.nodeIds).toEqual(['f']);
    const all = trailEntryFromTool({ ...base, name: 'run_graph', args: {}, result: '{}' });
    expect(all?.nodeIds).toEqual([]);
    expect(all?.label).toBe('运行整图');
  });

  it('run_node / update_node / delete_node — id from args', () => {
    expect(trailEntryFromTool({ ...base, name: 'run_node', args: { id: 'n' }, result: '{}' })?.nodeIds).toEqual(['n']);
    expect(trailEntryFromTool({ ...base, name: 'update_node', args: { id: 'n' }, result: '{}' })?.verb).toBe('update');
    expect(trailEntryFromTool({ ...base, name: 'delete_node', args: { id: 'n' }, result: '{}' })?.verb).toBe('delete');
  });

  it('malformed result never throws — falls back to running/empty', () => {
    const e = trailEntryFromTool({ ...base, name: 'add_node', args: { type: 'image' }, result: 'not json{' });
    expect(e?.status).toBe('done');
    expect(e?.nodeIds).toEqual([]);
  });

  it('error result → status error', () => {
    const e = trailEntryFromTool({ ...base, name: 'connect_nodes', args: { source: 's', target: 't' }, error: 'cycle' });
    expect(e?.status).toBe('error');
  });
});

describe('UNDOABLE_TRAIL_VERBS', () => {
  it('includes additive structural writes, excludes run/update/delete', () => {
    for (const v of ['add', 'connect', 'group', 'attach', 'orchestrate'] as const) {
      expect(UNDOABLE_TRAIL_VERBS.has(v)).toBe(true);
    }
    expect(UNDOABLE_TRAIL_VERBS.has('run')).toBe(false);
    expect(UNDOABLE_TRAIL_VERBS.has('update')).toBe(false);
    expect(UNDOABLE_TRAIL_VERBS.has('delete')).toBe(false);
  });
});
