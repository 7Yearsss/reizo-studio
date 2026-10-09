import { useEffect, useRef } from 'react';
import { DOMSerializer } from '@tiptap/pm/model';
import { documentSchema, parseDocumentContent } from '../../../shared/documentContent';
export default function DocumentReadOnly({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current; if (!host) return;
    host.replaceChildren(); const parsed = parseDocumentContent(content);
    if (!parsed) { host.textContent = '文档格式无效'; return; }
    host.append(DOMSerializer.fromSchema(documentSchema).serializeFragment(documentSchema.nodeFromJSON(parsed.doc).content));
  }, [content]);
  return <div ref={ref} className="document-prose p-6" aria-label="文档历史预览" onClick={(event) => { if ((event.target as Element).closest('a')) event.preventDefault(); }} />;
}
