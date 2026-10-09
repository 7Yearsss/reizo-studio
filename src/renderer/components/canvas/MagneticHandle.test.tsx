// @vitest-environment jsdom
import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Position } from '@xyflow/react';
import MagneticHandle from './MagneticHandle';
import { scheduleNodeInternals } from './batchNodeInternals';
import { updateConnectionLookup } from '@xyflow/system';
import { hasHandleConnection } from './handleConnection';
import type { ReactFlowState } from '@xyflow/react';

let mockStoreState: {
  transform: number[];
  nodes: Array<{ id: string; dragging?: boolean }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>;
} = {
  transform: [0, 0, 1.0],
  nodes: [{ id: 'node-1', dragging: false }],
  edges: [],
};

vi.mock('../ui/Tooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@xyflow/react', () => ({
  Position: {
    Left: 'left',
    Right: 'right',
    Top: 'top',
    Bottom: 'bottom',
  },
  Handle: (props: any) => (
    <div
      data-testid="rf-handle"
      data-position={props.position}
      data-type={props.type}
      style={props.style}
      className={props.className}
    />
  ),
  useReactFlow: () => ({
    screenToFlowPosition: (pt: { x: number; y: number }) => pt,
  }),
  useStore: (selector: any) => {
    const connectionLookup: ReactFlowState['connectionLookup'] = new Map();
    updateConnectionLookup(connectionLookup, new Map(), mockStoreState.edges);
    return selector({ ...mockStoreState, connectionLookup, nodeLookup: new Map(mockStoreState.nodes.map((node) => [node.id, node])) });
  },
  useStoreApi: () => ({ getState: () => mockStoreState }),
}));

describe('MagneticHandle', () => {
  it('keeps explicit ports, legacy bare-port connections and changed connections correct through the native index', () => {
    const lookup: ReactFlowState['connectionLookup'] = new Map();
    updateConnectionLookup(lookup, new Map(), [
      { id: 'named', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in' },
      { id: 'bare', source: 'c', target: 'd' },
      { id: 'separator', source: 'a-source', target: 'x', sourceHandle: 'other' },
    ]);
    expect(hasHandleConnection(lookup, 'a', 'source', 'out')).toBe(true);
    expect(hasHandleConnection(lookup, 'a', 'source', 'wrong')).toBe(false);
    expect(hasHandleConnection(lookup, 'a', 'source')).toBe(true);
    expect(hasHandleConnection(lookup, 'a', 'target', 'out')).toBe(false);
    expect(hasHandleConnection(lookup, 'b', 'target', 'in')).toBe(true);
    expect(hasHandleConnection(lookup, 'c', 'source', 'any')).toBe(true);
    expect(hasHandleConnection(lookup, 'd', 'target', 'any')).toBe(true);
    updateConnectionLookup(lookup, new Map(), [{ id: 'named', source: 'a', target: 'b', sourceHandle: 'new', targetHandle: 'in' }]);
    expect(hasHandleConnection(lookup, 'a', 'source', 'out')).toBe(false);
    expect(hasHandleConnection(lookup, 'a', 'source', 'new')).toBe(true);
    expect(hasHandleConnection(lookup, 'c', 'source', 'any')).toBe(false);
  });

  it('merges duplicate geometry requests from the same provider but isolates separate stores', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }));
    try {
      const host = (ids: string[]) => {
        const element = document.createElement('div');
        element.className = 'react-flow';
        for (const id of ids) {
          const node = document.createElement('div');
          node.className = 'react-flow__node'; node.dataset.id = id;
          element.append(node);
        }
        return element;
      };
      const updateA = vi.fn(); const updateB = vi.fn();
      const getStateA = () => ({ domNode: host(['same-id', 'other-id']), updateNodeInternals: updateA });
      const getStateB = () => ({ domNode: host(['same-id']), updateNodeInternals: updateB });
      scheduleNodeInternals({ getState: getStateA }, 'same-id');
      scheduleNodeInternals({ getState: getStateA }, 'same-id');
      scheduleNodeInternals({ getState: getStateA }, 'other-id');
      scheduleNodeInternals({ getState: getStateB }, 'same-id');
      expect(frames).toHaveLength(2);
      frames.forEach((callback) => callback(0));
      expect(updateA).toHaveBeenCalledTimes(1);
      expect([...updateA.mock.calls[0][0].keys()]).toEqual(['same-id', 'other-id']);
      expect(updateB).toHaveBeenCalledTimes(1);
      expect([...updateB.mock.calls[0][0].keys()]).toEqual(['same-id']);
      expect(updateA.mock.calls[0][0].get('same-id').force).toBe(true);
      expect(updateA.mock.calls[0][1]).toEqual({ triggerFitView: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('renders React Flow Handle directly with correct semantic position', () => {
    mockStoreState = {
      transform: [0, 0, 1.0],
      nodes: [{ id: 'node-1', dragging: false }],
      edges: [],
    };

    const leftHtml = renderToString(
      <MagneticHandle
        type="target"
        position={Position.Left}
        id="input_1"
        nodeId="node-1"
        nodeHovered={false}
      />,
    );

    expect(leftHtml).toContain('data-position="left"');
    expect(leftHtml).toContain('data-type="target"');

    const rightHtml = renderToString(
      <MagneticHandle
        type="source"
        position={Position.Right}
        id="output_1"
        nodeId="node-1"
        nodeHovered={false}
      />,
    );

    expect(rightHtml).toContain('data-position="right"');
    expect(rightHtml).toContain('data-type="source"');
  });

  it('keeps node border clean when unconnected and idle (socket and button hidden)', () => {
    mockStoreState = {
      transform: [0, 0, 1.0],
      nodes: [{ id: 'node-1', dragging: false }],
      edges: [],
    };

    const html = renderToString(
      <MagneticHandle
        type="source"
        position={Position.Right}
        id="out"
        nodeId="node-1"
        nodeHovered={false}
      />,
    );

    // Socket handle is transparent/hidden
    expect(html).toContain('opacity:0');
    // Button pop-out is hidden and has scale(0.3)
    expect(html).toContain('scale(0.3)');
  });

  it('displays persistent illuminated socket handle on the border when connected, even while unhovered', () => {
    mockStoreState = {
      transform: [0, 0, 1.0],
      nodes: [{ id: 'node-1', dragging: false }],
      edges: [
        { id: 'e1', source: 'node-1', target: 'node-2', sourceHandle: 'audio_out' },
      ],
    };

    const html = renderToString(
      <MagneticHandle
        type="source"
        position={Position.Right}
        id="audio_out"
        nodeId="node-1"
        kind="audio"
        nodeHovered={false}
      />,
    );

    // Connected socket handle is visible with opacity: 1 and audio color glow
    expect(html).toContain('opacity:1');
    expect(html).toContain('0 0 8px');
    // Plus button remains tucked in while idle
    expect(html).toContain('scale(0.3)');
  });

  it('springs out interactive plus button when node is hovered', () => {
    mockStoreState = {
      transform: [0, 0, 1.0],
      nodes: [{ id: 'node-1', dragging: false }],
      edges: [],
    };

    const html = renderToString(
      <MagneticHandle
        type="source"
        position={Position.Right}
        id="prompt_out"
        nodeId="node-1"
        kind="prompt"
        nodeHovered={true}
      />,
    );

    expect(html).toContain('scale(1)');
    expect(html).toContain('translate3d(0px, 0px, 0)');
    expect(html).toContain('data-handle-approach="true"');
    expect(html).toContain('aria-label="继续生成 / 引用该节点"');
    expect(html).not.toContain('tabindex="-1"');
  });

  it('tucks the plus onto the node border while idle so it can spring outward', () => {
    mockStoreState = {
      transform: [0, 0, 1.0],
      nodes: [{ id: 'node-1', dragging: false }],
      edges: [],
    };

    const rightHtml = renderToString(
      <MagneticHandle
        type="source"
        position={Position.Right}
        id="out"
        nodeId="node-1"
        nodeHovered={false}
      />,
    );
    expect(rightHtml).toContain('translate3d(-24px, 0px, 0) scale(0.3)');

    const leftHtml = renderToString(
      <MagneticHandle
        type="target"
        position={Position.Left}
        id="in"
        nodeId="node-1"
        nodeHovered={false}
      />,
    );
    expect(leftHtml).toContain('translate3d(24px, 0px, 0) scale(0.3)');
  });

  it('keeps a side approach rail hittable while the plus is still hidden', () => {
    mockStoreState = {
      transform: [0, 0, 1.0],
      nodes: [{ id: 'node-1', dragging: false }],
      edges: [],
    };

    const html = renderToString(
      <MagneticHandle
        type="source"
        position={Position.Right}
        id="out"
        nodeId="node-1"
        nodeHovered={false}
      />,
    );

    expect(html).toContain('data-handle-approach="true"');
    expect(html).toContain('pointer-events:auto');
    expect(html).toContain('scale(0.3)');
  });
});
