// Reizo's editor-only entry. The upstream editor remains AGPL-3.0-or-later.
import { useEffect, useState } from 'react';
import Editor from './Editor';
import { listProjects, loadProjectForEditing, renameProject } from './persist/projectStore';
import type { ProjectDoc } from './editor/types';
import type { ProjectMeta } from './persist/projectStoreCoordinators';

export default function App() {
  const [loaded, setLoaded] = useState<{ project: ProjectMeta; doc: ProjectDoc } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const id = new URLSearchParams(location.search).get('project');
    void (async () => {
      if (!id) throw new Error('请从 Reizo 打开剪辑工程。');
      const project = (await listProjects()).find((p) => p.id === id);
      if (!project) throw new Error('剪辑工程不存在，请重新打开面板。');
      const result = await loadProjectForEditing(id);
      if (result.status !== 'ok') throw new Error('工程读取失败，已停止打开以保护已保存内容。');
      if (alive) setLoaded({ project, doc: result.doc });
    })().catch((e) => { if (alive) setError(String(e.message ?? e)); });
    return () => { alive = false; };
  }, []);
  if (!loaded) return <div role={error ? 'alert' : 'status'} style={{ padding: 24 }}>{error || '正在打开剪辑工程…'}</div>;
  return <Editor initial={loaded.doc} project={loaded.project} onHome={() => {}} onRename={async (name) => {
    await renameProject(loaded.project.id, name);
    setLoaded((current) => current && ({ ...current, project: { ...current.project, name } }));
  }} />;
}
