import { useEffect, useMemo, useRef } from 'react';
import { sanitizeHtmlAnnotation, type HtmlAnnotation } from '../../../shared/htmlAnnotation';
import { HTML_PREVIEW_GUARD_SCRIPT } from './renderers/htmlGuards';
import { htmlAnnotateScript } from './htmlAnnotateScript';

export function htmlPreviewSource(html: string, run: boolean, annotate?: { nonce: string; token: string }): string {
  // Policy appears before all authored markup. The original source is never rewritten.
  // In annotate mode only the nonce'd inspector may run; the page's own scripts stay blocked.
  const scriptSrc = annotate ? `'nonce-${annotate.nonce}'` : run ? "'unsafe-inline'" : "'none'";
  const csp = `default-src 'none'; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; script-src ${scriptSrc}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const script = annotate ? `<script nonce="${annotate.nonce}">${htmlAnnotateScript(annotate.token)}</script>` : run ? `<script>${HTML_PREVIEW_GUARD_SCRIPT}</script>` : '';
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer">${script}${html}`;
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `onPick` switches on annotate mode: clicking an element reports it instead of using the page. */
export default function HtmlPreview({ html, run = false, title = 'HTML 页面预览', onPick }: { html: string; run?: boolean; title?: string; onPick?: (annotation: HtmlAnnotation) => void }) {
  const annotating = Boolean(onPick);
  const frame = useRef<HTMLIFrameElement>(null);
  const secrets = useMemo(() => ({ nonce: randomId(), token: randomId() }), [annotating]); // eslint-disable-line react-hooks/exhaustive-deps
  const source = useMemo(() => htmlPreviewSource(html, run, annotating ? secrets : undefined), [html, run, annotating, secrets]);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!annotating) return undefined;
    const listener = (event: MessageEvent): void => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { reizoAnnotate?: string } | null;
      if (!data || data.reizoAnnotate !== secrets.token) return;
      const annotation = sanitizeHtmlAnnotation({ ...data, file: title });
      if (annotation) pick.current?.(annotation);
    };
    window.addEventListener('message', listener);
    return (): void => window.removeEventListener('message', listener);
  }, [annotating, secrets, title]);

  return <iframe ref={frame} key={annotating ? 'annotate' : run ? 'run' : 'static'} title={title} sandbox={run || annotating ? 'allow-scripts' : ''} referrerPolicy="no-referrer" className="h-full min-h-64 w-full border-0 bg-white" srcDoc={source} />;
}
