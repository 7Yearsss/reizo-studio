import type { ReactFlowState } from '@xyflow/react';

type MeasurementStore = {
  getState: () => Pick<ReactFlowState, 'domNode' | 'updateNodeInternals'>;
};

// useStoreApi creates one wrapper per hook. Its getState function, rather than
// that wrapper object, identifies the underlying React Flow provider store.
const pendingByStore = new WeakMap<MeasurementStore['getState'], Set<string>>();

/** Coalesce handle geometry requests into one forced measurement per store/frame. */
export function scheduleNodeInternals(store: MeasurementStore, nodeId: string): void {
  const pending = pendingByStore.get(store.getState);
  if (pending) { pending.add(nodeId); return; }
  const ids = new Set([nodeId]);
  pendingByStore.set(store.getState, ids);
  requestAnimationFrame(() => {
    pendingByStore.delete(store.getState);
    const { domNode, updateNodeInternals } = store.getState();
    if (!domNode) return;
    const updates: Parameters<ReactFlowState['updateNodeInternals']>[0] = new Map();
    // One DOM traversal also avoids an attribute-selector scan for every ID.
    for (const element of domNode.querySelectorAll<HTMLDivElement>('.react-flow__node')) {
      const id = element.getAttribute('data-id');
      if (id && ids.has(id) && element.closest('.react-flow') === domNode) {
        updates.set(id, { id, nodeElement: element, force: true });
      }
    }
    if (updates.size) updateNodeInternals(updates, { triggerFitView: false });
  });
}
