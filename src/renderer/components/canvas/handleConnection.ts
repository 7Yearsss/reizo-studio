import type { ReactFlowState } from '@xyflow/react';

/** Query XYFlow's maintained adjacency index, rather than every edge on each pan tick. */
export function hasHandleConnection(lookup: ReactFlowState['connectionLookup'], nodeId: string,
  type: 'source' | 'target', handleId?: string): boolean {
  const connections = lookup.get(`${nodeId}-${type}`);
  if (!connections) return false;
  for (const connection of connections.values()) {
    // Check identity as well: imported IDs can contain the lookup's separator.
    const endpoint = type === 'source' ? connection.source : connection.target;
    const port = type === 'source' ? connection.sourceHandle : connection.targetHandle;
    if (endpoint === nodeId && (!port || !handleId || port === handleId)) return true;
  }
  return false;
}
