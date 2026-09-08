// @vitest-environment jsdom
import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Position } from '@xyflow/react';
import MagneticHandle from './MagneticHandle';

let mockStoreState: {
  transform: number[];
  nodes: Array<{ id: string; dragging?: boolean }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>;
} = {
  transform: [0, 0, 1.0],
  nodes: [{ id: 'node-1', dragging: false }],
  edges: [],
};

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
  useStore: (selector: any) => selector(mockStoreState),
  useUpdateNodeInternals: () => vi.fn(),
}));

describe('MagneticHandle', () => {
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

    // Plus button is visible and translated outward by constant popDistance (16px)
    expect(html).toContain('translate3d(16px, 0px, 0)');
    expect(html).toContain('scale(1)');
  });
});
