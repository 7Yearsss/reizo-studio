// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ImageGenerationPending from './ImageGenerationPending';

describe('ImageGenerationPending', () => {
  it('renders generation pending state with initial message and progress', () => {
    const html = renderToString(<ImageGenerationPending mode="generate" />);
    expect(html).toContain('正在解析提示词');
    expect(html).toContain('00:00');
    expect(html).toContain('10%');
  });

  it('renders edit pending state with edit message', () => {
    const html = renderToString(<ImageGenerationPending mode="edit" />);
    expect(html).toContain('正在解析选区与编辑指令');
    expect(html).toContain('00:00');
  });

  it('allows custom label override', () => {
    const html = renderToString(<ImageGenerationPending label="正在加载超分辨率模型…" />);
    expect(html).toContain('正在加载超分辨率模型…');
  });
});
