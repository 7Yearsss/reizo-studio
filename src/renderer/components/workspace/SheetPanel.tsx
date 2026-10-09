import { useEffect } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import * as api from '../../api';
import * as artifactStore from '../../state/artifactStore';
import { useArtifactStore } from '../../state/useArtifactStore';
import { flushSheetEdits, selectWorkbook, useSheetWorkspace } from '../../state/sheetWorkspace';
import { serializeSheetContent, workbookFromCreateSheets } from '../../../shared/sheetContent';
import { MAX_SHEET_UPLOAD_BYTES } from '../../../shared/sheetFile';
import SheetDocument from './SheetDocument';
import { WorkspaceShell } from './workspaceChrome';

export default function SheetPanel({ sessionId }: { sessionId: string }) {
  const artifacts = useArtifactStore((s) => s.bySession[sessionId]);
  const workbooks = (artifacts ?? []).filter((a) => a.kind === 'sheet');
  const selectedId = useSheetWorkspace((s) => s.selectedBySession[sessionId]);
  // An explicit '' means the user closed the workbook; undefined means nothing picked yet.
  const selected = selectedId === undefined ? workbooks[0] : workbooks.find((a) => a.id === selectedId);
  useEffect(() => { void artifactStore.loadSessionArtifacts(sessionId); }, [sessionId]);

  async function create() {
    const result = workbookFromCreateSheets([{ name: 'Sheet1' }]);
    if ('error' in result) throw new Error(result.error);
    const artifact = await api.createSessionArtifact(sessionId, { name: `工作簿 ${workbooks.length + 1}.xlsx`, kind: 'sheet', source: 'manual', content: serializeSheetContent(result.content) });
    artifactStore.upsertArtifact(artifact);
    selectWorkbook(sessionId, artifact.id);
  }
  async function upload(files: File[]) {
    for (const file of files) {
      if (!/\.xlsx$/i.test(file.name)) throw new Error('请选择 .xlsx 文件；.xls 和 .xlsm 请先另存为 .xlsx');
      if (file.size > MAX_SHEET_UPLOAD_BYTES) throw new Error('表格超过 8 MB 上限');
      const artifact = await api.importSheet(sessionId, file);
      artifactStore.upsertArtifact(artifact);
      selectWorkbook(sessionId, artifact.id);
    }
  }
  return <WorkspaceShell icon={<FileSpreadsheet />} title="Excel 工作区" noun="工作簿" items={workbooks} selected={selected}
    flush={() => flushSheetEdits(sessionId)} select={(id) => selectWorkbook(sessionId, id)} create={create} importFiles={upload} multiple
    accept=".xlsx" importHint=".xlsx · 8 MB 以内" importLabel="导入 Excel"
    description="新建或导入 .xlsx 工作簿。选中单元格后，可在对话中让 Agent 分析数据或补充公式。">
    {selected && <SheetDocument key={selected.id} artifact={selected} onClose={() => void flushSheetEdits(sessionId).then(() => selectWorkbook(sessionId, ''), () => { /* Unsaved edits keep the workbook open. */ })} />}
  </WorkspaceShell>;
}
