import { useEffect, useRef, useState } from 'react';
import { BookOpen, Trash2 } from 'lucide-react';
import * as api from '../../api';
import { toast } from '../../lib/toast';
import { knowledgeFileProblem, looksBinary, OFFICE_FILE } from '../../../shared/knowledgeFiles';

/** The user's own reference material: imported text files that the assistant can search and cite by file name. */
export default function KnowledgeSection() {
  const [docs, setDocs] = useState<api.KnowledgeDocDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const refresh = (): void => { void api.listKnowledge().then(setDocs, (): void => setDocs([])); };
  useEffect(refresh, []);

  async function importFiles(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    setBusy(true);
    let added = 0;
    try {
      for (const file of Array.from(files)) {
        const problem = knowledgeFileProblem(file);
        if (problem) { toast.error('无法导入', problem); continue; }
        try {
          if (OFFICE_FILE.test(file.name)) await api.addKnowledgeFile(file);
          else {
            const text = await file.text();
            if (looksBinary(text)) { toast.error('无法导入', `「${file.name}」不是文本文件`); continue; }
            await api.addKnowledge(file.name, text);
          }
          added += 1;
        }
        catch (error) { toast.error(`「${file.name}」导入失败`, error instanceof Error ? error.message : undefined); }
      }
      if (added > 0) toast.success(`已导入 ${added} 份资料`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
      refresh();
    }
  }

  async function remove(doc: api.KnowledgeDocDto): Promise<void> {
    await api.removeKnowledge(doc.id);
    refresh();
  }

  return (
    <section className="mb-8 max-w-3xl">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><BookOpen size={16} /> 资料库</h2>
      <p className="mb-3 text-sm text-ink-muted">把你的政策、产品资料、品牌规范、笔记放进来，助手回答时会先从这里查，并说明出自哪个文件。支持文本类文件（.txt、.md、.csv、.json、.html 等）和 Word（.docx）、Excel（.xlsx）、PowerPoint（.pptx）；PDF 暂不支持，请先另存为文本。资料保存在本机，被查到的片段会随提问发给你所用的模型服务。</p>
      <input ref={input} type="file" multiple className="hidden" onChange={(e) => void importFiles(e.target.files)} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper-raised disabled:opacity-50">{busy ? '导入中…' : '导入文件'}</button>
      {docs && docs.length > 0 && (
        <ul className="mt-4 space-y-1">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 rounded-lg bg-paper-inset/60 px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-ink" title={doc.name}>{doc.name}</span>
              <span className="shrink-0 text-xs text-ink-muted">{doc.chars.toLocaleString()} 字 · {doc.chunks} 段</span>
              <button type="button" aria-label={`删除 ${doc.name}`} onClick={() => void remove(doc)} className="shrink-0 text-ink-muted hover:text-danger"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {docs && docs.length === 0 && <p className="mt-4 text-sm text-ink-muted">还没有资料。</p>}
    </section>
  );
}
