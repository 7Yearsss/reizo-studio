import { PeleError, render } from 'pele';

export interface MermaidDrawing {
  svg: string;
  type: string;
}

export interface MermaidFailure {
  message: string;
}

/** Draw Mermaid source once. Click targets and remote images stay out of the SVG. */
export function renderMermaid(source: string, idPrefix: string): MermaidDrawing | MermaidFailure {
  const text = source.trim();
  if (!text) return { message: '空的图表' };
  try {
    const drawn = render(text, {
      idPrefix,
      responsive: false,
      links: false,
      images: false,
    });
    return { svg: drawn.svg, type: drawn.type };
  } catch (error) {
    if (error instanceof PeleError) return { message: summarizePeleError(error.message) };
    return { message: '图表无法绘制' };
  }
}

export function isMermaidDrawing(value: MermaidDrawing | MermaidFailure): value is MermaidDrawing {
  return 'svg' in value;
}

function summarizePeleError(message: string): string {
  const lines = message.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return lines[0] ?? '图表无法绘制';
  return `${lines[0]} ${lines[lines.length - 1]}`;
}
