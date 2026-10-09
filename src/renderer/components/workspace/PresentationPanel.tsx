import { useEffect } from 'react';
import { Presentation } from 'lucide-react';
import * as api from '../../api';
import * as artifacts from '../../state/artifactStore';
import { useArtifactStore } from '../../state/useArtifactStore';
import { selectPresentation, usePresentationWorkspace } from '../../state/presentationWorkspace';
import { flushEditorEdits } from '../../state/editorPersistence';
import { createPresentation } from '../../../shared/presentationContent';
import PresentationEditor from './PresentationEditor';
import { WorkspaceShell } from './workspaceChrome';

export default function PresentationPanel({ sessionId }: { sessionId: string }) {
  const all = useArtifactStore((s) => s.bySession[sessionId]); const decks = (all ?? []).filter((a) => a.kind === 'presentation');
  const selectedId = usePresentationWorkspace((s) => s.selected[sessionId]); const selected = decks.find((a) => a.id === selectedId) ?? decks[0];
  useEffect(() => { void artifacts.loadSessionArtifacts(sessionId); }, [sessionId]);
  async function create() { const name = `演示稿 ${decks.length + 1}`; const artifact = await api.createSessionArtifact(sessionId, { name, kind: 'presentation', source: 'manual', content: JSON.stringify(createPresentation(name)) }); artifacts.upsertArtifact(artifact); selectPresentation(sessionId, artifact.id); }
  async function upload([file]: File[]) {
    if (!/\.(pptx|reizo-ppt\.json)$/i.test(file.name)) throw new Error('请选择 .pptx 文件');
    const artifact = await api.importPresentation(sessionId, file); artifacts.upsertArtifact(artifact); selectPresentation(sessionId, artifact.id);
  }
  return <WorkspaceShell icon={<Presentation />} title="PPT 工作区" noun="演示稿" items={decks} selected={selected}
    flush={() => flushEditorEdits(sessionId)} select={(id) => selectPresentation(sessionId, id)} create={create} importFiles={upload}
    accept=".pptx,.reizo-ppt.json" importHint=".pptx" importLabel="导入 PPT"
    description="按页编辑文字、图片、形状、表格与图表。选中元素或整页交给 AI 修改，审核后才会更新演示稿。">
    {selected && <PresentationEditor key={selected.id} artifact={selected} />}
  </WorkspaceShell>;
}
