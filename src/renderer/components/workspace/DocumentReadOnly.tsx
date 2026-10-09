import { useEffect, useRef } from 'react';
import { DOMSerializer } from '@tiptap/pm/model';
import { documentSchema, parseDocumentContent, typographyCss } from '../../../shared/documentContent';
export default function DocumentReadOnly({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const parsedContent = parseDocumentContent(content);
  useEffect(() => {
    const host = ref.current; if (!host) return;
    host.replaceChildren(); const parsed = parseDocumentContent(content);
    if (!parsed) { host.textContent = '文档格式无效'; return; }
    host.append(DOMSerializer.fromSchema(documentSchema).serializeFragment(documentSchema.nodeFromJSON(parsed.doc).content));
  }, [content]);
  return <div ref={ref} className="document-prose p-6" style={cssToStyle(typographyCss(parsedContent))} aria-label="文档历史预览" onClick={(event) => { if ((event.target as Element).closest('a')) event.preventDefault(); }} />;
}

export function cssToStyle(css: string): React.CSSProperties {
  const style: Record<string, string> = {};
  for (const part of css.split(';')) { const i = part.indexOf(':'); if (i > 0) style[part.slice(0, i).trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = part.slice(i + 1).trim(); }
  return style;
}
