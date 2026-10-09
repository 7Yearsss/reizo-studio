// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../../shared/canvas';

const useStore = vi.hoisted(() => vi.fn());
vi.mock('@xyflow/react', () => ({ useStore }));
vi.mock('../../ui/Tooltip', () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }));

const deriveImageEdit = vi.fn();
vi.mock('../../../state/canvasStore', () => ({
  deriveImageEdit: (...args: unknown[]) => deriveImageEdit(...args),
}));

import ImageNodeEditToolbar from './ImageNodeEditToolbar';

const node: CanvasNode = {
  id: 'img-1',
  canvasId: 'c1',
  type: 'image',
  x: 0,
  y: 0,
  w: 320,
  h: 380,
  title: '图',
  params: { prompt: 'a', size: '1024x1024' },
  paramsHash: null,
  runState: 'done',
  output: { assets: ['c1/a.png'] },
  updatedAt: '',
};

describe('ImageNodeEditToolbar', () => {
  it('renders primary edit actions when visible', () => {
    const canvas = document.createElement('div');
    const host = document.createElement('div');
    document.body.append(canvas, host);
    useStore.mockImplementation((selector) => selector({ domNode: canvas, nodeLookup: new Map(), transform: [0, 0, 0.05], width: 650, height: 600 }));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe(): void { return undefined; } disconnect(): void { return undefined; } });
    const root = createRoot(host);
    try {
      act(() => root.render(<ImageNodeEditToolbar sessionId="s1" node={node} visible />));
      const toolbar = canvas.querySelector<HTMLElement>('[aria-label="图片编辑工具"]');
      expect(toolbar?.parentElement).toBe(canvas);
      expect(toolbar?.style.transform).toBe('');
      const html = toolbar?.innerHTML ?? '';
      expect(html).toContain('lucide-crop');
      expect(html).toContain('lucide-grid-3x3');
      expect(html).toContain('lucide-box');
      expect(html).toContain('lucide-brush');
      expect(html).toContain('lucide-lightbulb');
      expect(html).toContain('lucide-ellipsis');
      const calls = useStore.mock.calls.length;
      act(() => root.render(<ImageNodeEditToolbar sessionId="s1" node={node} visible={false} />));
      expect(canvas.querySelector('[aria-label="图片编辑工具"]')).toBeNull();
      expect(useStore.mock.calls.length).toBe(calls);
    } finally {
      act(() => root.unmount()); canvas.remove(); host.remove(); vi.unstubAllGlobals();
    }
  });
});
