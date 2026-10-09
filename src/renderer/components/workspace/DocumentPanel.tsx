import { useEffect } from 'react';
import { FileText } from 'lucide-react';
import * as api from '../../api';
import * as artifacts from '../../state/artifactStore';
import { useArtifactStore } from '../../state/useArtifactStore';
import { selectDocument, useDocumentWorkspace } from '../../state/documentWorkspace';
import { flushEditorEdits } from '../../state/editorPersistence';
import DocumentEditor from './DocumentEditor';
import { WorkspaceShell } from './workspaceChrome';

export default function DocumentPanel({ sessionId }: { sessionId: string }) {
  const all = useArtifactStore((s) => s.bySession[sessionId]);
  const documents = (all ?? []).filter((a) => a.kind === 'doc');
  const selectedId = useDocumentWorkspace((s) => s.selected[sessionId]);
  const selected = documents.find((a) => a.id === selectedId) ?? documents[0];
  useEffect(() => { void artifacts.loadSessionArtifacts(sessionId); }, [sessionId]);
  async function create() {
    const doc = await api.createDocument(sessionId, `文档 ${documents.length + 1}`);
    artifacts.upsertArtifact(doc); selectDocument(sessionId, doc.id);
  }
  async function upload([file]: File[]) {
    if (!/\.docx$/i.test(file.name) || file.size > 8 * 1024 * 1024) throw new Error('请选择 8 MB 以内的 .docx 文件');
    const doc = await api.importDocument(sessionId, file);
    artifacts.upsertArtifact(doc); selectDocument(sessionId, doc.id);
  }
  return <WorkspaceShell icon={<FileText />} title="Doc 工作区" noun="文档" items={documents} selected={selected}
    flush={() => flushEditorEdits(sessionId)} select={(id) => selectDocument(sessionId, id)} create={create} importFiles={upload}
    accept=".docx" importHint=".docx · 8 MB 以内" importLabel="导入 Word"
    description="新建文档或导入 Word 文件。选中一段文字交给 AI 修改，你逐处审核后才会写入原文。">
    {selected && <DocumentEditor key={selected.id} artifact={selected} />}
  </WorkspaceShell>;
}
