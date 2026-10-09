import { useEffect } from 'react';
import { Code2 } from 'lucide-react';
import * as api from '../../api';
import * as artifacts from '../../state/artifactStore';
import { useArtifactStore } from '../../state/useArtifactStore';
import { selectHtml, useHtmlWorkspace } from '../../state/htmlWorkspace';
import { flushEditorEdits } from '../../state/editorPersistence';
import { EMPTY_HTML, MAX_HTML_BYTES, validateHtmlContent } from '../../../shared/htmlContent';
import HtmlEditor from './HtmlEditor';
import { WorkspaceShell } from './workspaceChrome';

export default function HtmlPanel({ sessionId }: { sessionId: string }) {
  const all = useArtifactStore((s) => s.bySession[sessionId]);
  const pages = (all ?? []).filter((a) => a.kind === 'html');
  const selectedId = useHtmlWorkspace((s) => s.selected[sessionId]);
  const selected = pages.find((a) => a.id === selectedId) ?? pages[0];
  useEffect(() => { void artifacts.loadSessionArtifacts(sessionId); }, [sessionId]);
  async function create(name: string, content: string) {
    const artifact = await api.createSessionArtifact(sessionId, { name, content: validateHtmlContent(content), kind: 'html', source: 'manual' });
    artifacts.upsertArtifact(artifact); selectHtml(sessionId, artifact.id);
  }
  async function upload([file]: File[]) {
    if (!/\.html?$/i.test(file.name) || file.size > MAX_HTML_BYTES) throw new Error('请选择 2 MB 以内的 HTML 文件');
    await create(file.name, new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
  }
  return <WorkspaceShell icon={<Code2 />} title="HTML 工作区" noun="页面" items={pages} selected={selected}
    flush={() => flushEditorEdits(sessionId)} select={(id) => selectHtml(sessionId, id)} create={() => create(`页面 ${pages.length + 1}.html`, EMPTY_HTML)} importFiles={upload}
    accept=".html,.htm" importHint=".html · 2 MB 以内" importLabel="导入 HTML"
    description="编辑页面源码并预览效果。选中源码交给 AI，查看修改差异后决定是否接受。">
    {selected && <HtmlEditor key={selected.id} artifact={selected} />}
  </WorkspaceShell>;
}
