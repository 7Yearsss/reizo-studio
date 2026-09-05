// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import FloatingNodeHeader from './FloatingNodeHeader';

let mockZoom = 1.0;

vi.mock('@xyflow/react', () => ({
  useStore: (selector: any) => selector({ transform: [0, 0, mockZoom] }),
}));

describe('FloatingNodeHeader', () => {
  it('renders at scale(1) at normal zoom with full details visible', () => {
    mockZoom = 1.0;
    const html = renderToString(
      <FloatingNodeHeader
        sessionId="session-1"
        nodeId="node-1"
        title="我的生成节点"
        fallback="生图"
        icon={<span data-testid="icon">ICON</span>}
        badge={<span data-testid="badge">变体 1/4</span>}
        status={<span data-testid="status">就绪</span>}
        actions={<button type="button">设置</button>}
      />,
    );

    expect(html).toContain('scale(1)');
    expect(html).toContain('我的生成节点');
    expect(html).toContain('变体 1/4');
    expect(html).toContain('就绪');
    expect(html).toContain('设置');
  });

  it('calculates inverse zoom scale at low zoom (scale = 1 / zoom) and hides minor details for clean canvas overview', () => {
    mockZoom = 0.25; // 4x scale needed
    const html = renderToString(
      <FloatingNodeHeader
        sessionId="session-1"
        nodeId="node-2"
        title="全景图节点"
        fallback="生图"
        icon={<span data-testid="icon">ICON</span>}
        badge={<span data-testid="badge">变体 1/4</span>}
        status={<span data-testid="status">就绪</span>}
        actions={<button type="button">设置</button>}
      />,
    );

    // Inverse scale 1 / 0.25 = 4
    expect(html).toContain('scale(4)');
    // Title is crisp and readable
    expect(html).toContain('全景图节点');
    // Details are hidden to avoid clutter at bird's-eye view (LOD)
    expect(html).not.toContain('变体 1/4');
    expect(html).not.toContain('就绪');
    expect(html).not.toContain('设置');
  });

  it('reveals full details even at low zoom when selected or hovered', () => {
    mockZoom = 0.2; // 5x scale needed
    const html = renderToString(
      <FloatingNodeHeader
        sessionId="session-1"
        nodeId="node-3"
        title="特写镜头"
        fallback="生图"
        icon={<span data-testid="icon">ICON</span>}
        badge={<span data-testid="badge">变体 1/4</span>}
        status={<span data-testid="status">就绪</span>}
        actions={<button type="button">设置</button>}
        selected={true}
      />,
    );

    expect(html).toContain('scale(5)');
    expect(html).toContain('特写镜头');
    // Because selected=true, details are shown even at low zoom
    expect(html).toContain('变体 1/4');
    expect(html).toContain('就绪');
    expect(html).toContain('设置');
  });

  it('renders fallback title when title is empty', () => {
    mockZoom = 1.0;
    const html = renderToString(
      <FloatingNodeHeader
        sessionId="session-1"
        nodeId="node-4"
        title=""
        fallback="文本"
        icon={<span>ICON</span>}
      />,
    );

    expect(html).toContain('文本');
  });
});
