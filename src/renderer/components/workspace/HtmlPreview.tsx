import { useMemo } from 'react';
import { HTML_PREVIEW_GUARD_SCRIPT } from './renderers/htmlGuards';

export function htmlPreviewSource(html: string, run: boolean): string {
  // Policy appears before all authored markup. The original source is never rewritten.
  const csp = `default-src 'none'; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; script-src ${run ? "'unsafe-inline'" : "'none'"}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer">${run ? `<script>${HTML_PREVIEW_GUARD_SCRIPT}</script>` : ''}${html}`;
}
export default function HtmlPreview({ html, run = false, title = 'HTML 页面预览' }: { html: string; run?: boolean; title?: string }) {
  const source = useMemo(() => htmlPreviewSource(html, run), [html, run]);
  return <iframe key={run ? 'run' : 'static'} title={title} sandbox={run ? 'allow-scripts' : ''} referrerPolicy="no-referrer" className="h-full min-h-64 w-full border-0 bg-white" srcDoc={source} />;
}
