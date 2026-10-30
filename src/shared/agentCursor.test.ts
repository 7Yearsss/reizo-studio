import { describe, expect, it } from 'vitest';
import { agentCursorTarget } from './agentCursor';
import type { AgentTrailEntry } from './agentTrail';

const nodes = [{ id: 'a', x: 0, y: 0, w: 100, h: 60 }, { id: 'b', x: 400, y: 200, w: 200, h: 100 }];
const entry = (over: Partial<AgentTrailEntry>): AgentTrailEntry => ({ id: 'e', tool: 't', verb: 'create' as never, label: '', nodeIds: ['a'], at: 1000, status: 'done', ...over });

describe('agentCursorTarget', () => {
  it('sits on the centre of the node the latest action touched', () => {
    const t = agentCursorTarget([entry({ at: 1000 }), entry({ id: 'f', at: 2000, nodeIds: ['b'] })], nodes, 3000);
    expect(t).toEqual({ nodeId: 'b', x: 500, y: 250, working: false });
  });

  it('marks a running action as working and keeps it past the linger time', () => {
    const t = agentCursorTarget([entry({ status: 'running', at: 0 })], nodes, 60000);
    expect(t).toMatchObject({ nodeId: 'a', working: true });
  });

  it('treats a running call that never finished as lost', () => {
    expect(agentCursorTarget([entry({ status: 'running', at: 0 })], nodes, 200_000)).toBeNull();
  });

  it('goes away after the linger time, on errors, and for nodes that no longer exist', () => {
    expect(agentCursorTarget([entry({ at: 0 })], nodes, 60000)).toBeNull();
    expect(agentCursorTarget([entry({ status: 'error' })], nodes, 1500)).toBeNull();
    expect(agentCursorTarget([entry({ nodeIds: ['gone'] })], nodes, 1500)).toBeNull();
    expect(agentCursorTarget([], nodes, 0)).toBeNull();
  });
});
