import { useEffect, useRef, useState } from 'react';
import { BookOpen, Trash2 } from 'lucide-react';
import * as api from '../../api';
import { toast } from '../../lib/toast';
import { knowledgeFileProblem, looksBinary, OFFICE_FILE, pickFolderFiles } from '../../../shared/knowledgeFiles';

/** The user's own reference material: imported text files that the assistant can search and cite by file name. */
export default function KnowledgeSection() {
  const [docs, setDocs] = useState<api.KnowledgeDocDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const refresh = (): void => { void api.listKnowledge().then(setDocs, (): void => setDocs([])); };
  useEffect(refresh, []);

  /** `fromFolder`: names keep their folder path, files that cannot be read are skipped with one summary instead of a toast each. */
  async function importFiles(files: FileList | null, fromFolder = false): Promise<void> {
    if (!files?.length) return;
    setBusy(true);
    let added = 0;
    let failed = 0;
    try {
      let list = Array.from(files).map((file) => ({ file, name: fromFolder ? (file.webkitRelativePath || file.name) : file.name }));
      if (fromFolder) {
        const { picked, skipped, truncated } = pickFolderFiles(list.map((item) => ({ ...item, path: item.name, size: item.file.size })));
        list = picked;
        if (skipped > 0 || truncated) toast.info(`已跳过 ${skipped} 个非文档文件`, truncated ? '文件夹内文档太多，只导入前 200 个' : undefined);
      }
      for (const { file, name } of list) {
        const problem = knowledgeFileProblem(file);
        if (problem) { if (fromFolder) failed += 1; else toast.error('无法导入', problem); continue; }
        try {
          if (OFFICE_FILE.test(file.name)) await api.addKnowledgeFile(file, name);
          else {
            const text = await file.text();
            if (looksBinary(text)) { if (fromFolder) failed += 1; else toast.error('无法导入', `「${file.name}」不是文本文件`); continue; }
            await api.addKnowledge(name, text);
          }
          added += 1;
        }
        catch (error) { if (fromFolder) failed += 1; else toast.error(`「${file.name}」导入失败`, error instanceof Error ? error.message : undefined); }
      }
      if (added > 0) toast.success(`已导入 ${added} 份资料`, failed > 0 ? `${failed} 份读取失败（加密、损坏或格式不支持）` : undefined);
      else if (failed > 0) toast.error('没有导入成功', `${failed} 份读取失败`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
      if (folderInput.current) folderInput.current.value = '';
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
      <p className="mb-3 text-sm text-ink-muted">把你的政策、产品资料、品牌规范、笔记放进来，助手回答时会先从这里查，并说明出自哪个文件。支持文本类文件（.txt、.md、.csv、.json、.html 等）和 Word（.docx）、Excel（.xlsx）、PowerPoint（.pptx）和带文字的 PDF（扫描件无法识别文字）。资料保存在本机，被查到的片段会随提问发给你所用的模型服务。</p>
      <input ref={input} type="file" multiple className="hidden" onChange={(e) => void importFiles(e.target.files)} />
      <input ref={folderInput} type="file" multiple className="hidden" onChange={(e) => void importFiles(e.target.files, true)} {...{ webkitdirectory: '', directory: '' }} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper-raised disabled:opacity-50">{busy ? '导入中…' : '导入文件'}</button>
      <button type="button" disabled={busy} onClick={() => folderInput.current?.click()} title="资料更新后再次选择同一个文件夹即可刷新（同名文件会被替换）" className="ml-2 rounded-full bg-paper-inset px-4 py-1.5 text-sm text-ink disabled:opacity-50">导入文件夹</button>
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
