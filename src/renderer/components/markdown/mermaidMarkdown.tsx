import { Children, isValidElement, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import MermaidDiagram from './MermaidDiagram';

const MERMAID_LANG = new Set(['mermaid', 'mmd']);

export function fencedMermaidSource(children: ReactNode): string | null {
  for (const node of Children.toArray(children)) {
    if (!isValidElement<{ className?: string; children?: ReactNode }>(node)) continue;
    const lang = /language-([\w-]+)/.exec(node.props.className ?? '')?.[1];
    if (!lang || !MERMAID_LANG.has(lang)) continue;
    return String(node.props.children ?? '').replace(/\n$/, '');
  }
  return null;
}

/** react-markdown `components` that draw ```mermaid fences with Pele. */
export const mermaidMarkdownComponents: Components = {
  pre({ children }) {
    const source = fencedMermaidSource(children);
    if (source === null) return <pre>{children}</pre>;
    return <MermaidDiagram source={source} />;
  },
};

export function MermaidStreamBlock({ code, isIncomplete }: { code: string; isIncomplete: boolean }) {
  return <MermaidDiagram source={code} pending={isIncomplete} />;
}
