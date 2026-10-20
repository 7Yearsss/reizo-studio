import { describe, expect, it } from 'vitest';
import { isMermaidDrawing, renderMermaid } from './renderMermaid';

describe('renderMermaid', () => {
  it('draws a flowchart to themed SVG', () => {
    const drawn = renderMermaid('flowchart LR\n  A[客户端] --> B[API]', 'd1');
    expect(isMermaidDrawing(drawn)).toBe(true);
    if (!isMermaidDrawing(drawn)) return;
    expect(drawn.type).toBe('flowchart');
    expect(drawn.svg).toContain('<svg');
    expect(drawn.svg).toContain('class="pele pele-flowchart"');
    expect(drawn.svg).toContain('客户端');
    expect(drawn.svg).not.toContain('<a ');
  });

  it('reports a syntax error without throwing', () => {
    const drawn = renderMermaid('flowchart LR\n  A -->', 'd2');
    expect(isMermaidDrawing(drawn)).toBe(false);
    if (isMermaidDrawing(drawn)) return;
    expect(drawn.message).toContain('line');
  });

  it('rejects an empty fence', () => {
    const drawn = renderMermaid('   \n', 'd3');
    expect(isMermaidDrawing(drawn)).toBe(false);
  });
});
