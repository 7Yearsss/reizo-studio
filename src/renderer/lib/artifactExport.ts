import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Artifact } from '../../shared/artifact';

const PRINT_CSS = `
  :root { color-scheme: light; }
  body { font: 14px/1.65 -apple-system, "Segoe UI", system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
         color: #1c1712; margin: 40px; max-width: 760px; }
  h1,h2,h3 { line-height: 1.3; margin: 1.4em 0 0.5em; }
  h1 { font-size: 1.8em; } h2 { font-size: 1.4em; } h3 { font-size: 1.15em; }
  p, li { margin: 0.5em 0; }
  pre { background: #f5f3ef; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
  code { background: #f5f3ef; padding: 0.1em 0.3em; border-radius: 4px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; } td, th { border: 1px solid #ddd; padding: 6px 10px; }
  img { max-width: 100%; }
  blockquote { border-left: 3px solid #ddd; margin: 0.8em 0; padding-left: 1em; color: #555; }
`;

/** An artifact's current text as a standalone, print-styled HTML document. */
export function toHtmlDocument(artifact: Artifact, text: string): string {
  if (artifact.kind === 'html') {
    // Already a document — inject print CSS if it has a <head>.
    if (/<head[^>]*>/i.test(text)) {
      return text.replace(/<head([^>]*)>/i, `<head$1><style>${PRINT_CSS}</style>`);
    }
    return `<!doctype html><html><head><meta charset="utf-8"><style>${PRINT_CSS}</style></head><body>${text}</body></html>`;
  }
  const inner =
    artifact.kind === 'markdown' || artifact.kind === 'text'
      ? renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, text))
      : `<pre>${escapeHtml(text)}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    artifact.name,
  )}</title><style>${PRINT_CSS}</style></head><body>${inner}</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
}

/** Trigger a browser download of a base64 blob. */
export function downloadBase64(base64: string, filename: string, mime: string): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
