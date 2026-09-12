// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../../shared/canvas';

vi.mock('@xyflow/react', () => ({
  useStore: (selector: (s: { transform: number[] }) => unknown) => selector({ transform: [0, 0, 1] }),
}));

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
    const html = renderToString(
      <ImageNodeEditToolbar sessionId="s1" node={node} visible />,
    );
    expect(html).toContain('裁剪');
    expect(html).toContain('多角度');
    expect(html).toContain('重绘');
    expect(html).toContain('打光');
    expect(html).toContain('更多');
  });
});
