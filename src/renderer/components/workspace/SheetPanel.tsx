import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, Plus, Upload } from 'lucide-react';
import * as api from '../../api';
import * as artifactStore from '../../state/artifactStore';
import { useArtifactStore } from '../../state/useArtifactStore';
import { flushSheetEdits, selectWorkbook, useSheetWorkspace } from '../../state/sheetWorkspace';
import { serializeSheetContent, workbookFromCreateSheets } from '../../../shared/sheetContent';
import { MAX_SHEET_UPLOAD_BYTES } from '../../../shared/sheetFile';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty';
import { Alert, AlertDescription } from '../ui/alert';
import SheetDocument from './SheetDocument';

export default function SheetPanel({ sessionId }: { sessionId: string }) {
  const artifacts = useArtifactStore((s) => s.bySession[sessionId]);
  const workbooks = (artifacts ?? []).filter((a) => a.kind === 'sheet');
  const selectedId = useSheetWorkspace((s) => s.selectedBySession[sessionId]);
  const selected = selectedId === undefined ? workbooks[0] : workbooks.find((a) => a.id === selectedId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void artifactStore.loadSessionArtifacts(sessionId); }, [sessionId]);

  async function pick(id: string) {
    try { await flushSheetEdits(sessionId); selectWorkbook(sessionId, id); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '请先保存当前表格'); }
  }
  async function create() {
    setBusy(true);
    setError(null);
    try {
      await flushSheetEdits(sessionId);
      const result = workbookFromCreateSheets([{ name: 'Sheet1' }]);
      if ('error' in result) throw new Error(result.error);
      const artifact = await api.createSessionArtifact(sessionId, { name: `工作簿 ${workbooks.length + 1}.xlsx`, kind: 'sheet', source: 'manual', content: serializeSheetContent(result.content) });
      artifactStore.upsertArtifact(artifact);
      selectWorkbook(sessionId, artifact.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建失败'); }
    finally { setBusy(false); }
  }
  async function upload(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      await flushSheetEdits(sessionId);
      for (const file of files) {
        if (!/\.xlsx$/i.test(file.name)) throw new Error('请选择 .xlsx 文件；.xls 和 .xlsm 请先另存为 .xlsx');
        if (file.size > MAX_SHEET_UPLOAD_BYTES) throw new Error('表格超过 8 MB 上限');
        const artifact = await api.importSheet(sessionId, file);
        artifactStore.upsertArtifact(artifact);
        selectWorkbook(sessionId, artifact.id);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败'); }
    finally { setBusy(false); }
  }
  return <div className="flex h-full min-h-0 flex-col" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy) void upload(Array.from(event.dataTransfer.files)); }}>
    <input ref={fileInput} hidden type="file" accept=".xlsx" multiple onChange={(event) => { void upload(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    <div className="flex items-center gap-2 border-b border-line p-2">
      <FileSpreadsheet className="size-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <Select value={selected?.id ?? ''} onValueChange={(id) => void pick(id)} disabled={busy || !workbooks.length}>
          <SelectTrigger aria-label="选择 Excel 工作簿"><SelectValue placeholder="Excel 工作区" /></SelectTrigger>
          <SelectContent><SelectGroup>{workbooks.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </div>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void create()}><Plus data-icon="inline-start" />新建</Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}><Upload data-icon="inline-start" />导入</Button>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {busy && <p role="status" className="px-3 py-1 text-xs text-ink-muted">正在处理工作簿…</p>}
    {selected ? <SheetDocument key={selected.id} artifact={selected} onClose={() => void pick('')} /> : <Empty>
      <EmptyHeader><EmptyMedia variant="icon"><FileSpreadsheet /></EmptyMedia><EmptyTitle>Excel 工作区</EmptyTitle><EmptyDescription>新建或拖入 .xlsx 工作簿。选中单元格后，可在对话中让 Agent 分析数据或补充公式。</EmptyDescription></EmptyHeader>
      <Button disabled={busy} onClick={() => void create()}><Plus data-icon="inline-start" />新建表格</Button>
    </Empty>}
  </div>;
}
