// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ImageGenerationPending from './ImageGenerationPending';

describe('ImageGenerationPending', () => {
  it('renders generation pending state with initial message', () => {
    const html = renderToString(<ImageGenerationPending mode="generate" />);
    expect(html).toContain('正在解析提示词');
  });

  it('renders edit pending state with edit message', () => {
    const html = renderToString(<ImageGenerationPending mode="edit" />);
    expect(html).toContain('正在解析选区与编辑指令');
  });

  it('allows custom label override', () => {
    const html = renderToString(<ImageGenerationPending label="正在加载超分辨率模型…" />);
    expect(html).toContain('正在加载超分辨率模型…');
  });

  it('draws a mosaic canvas in the picture colours when a source image is given', () => {
    const html = renderToString(<ImageGenerationPending sampleSrc="data:image/png;base64,AA==" />);
    expect(html).toContain('<canvas');
    expect(renderToString(<ImageGenerationPending />)).not.toContain('<canvas aria-hidden="true" class="absolute inset-0 h-full w-full"');
  });
});
