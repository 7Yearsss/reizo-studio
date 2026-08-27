import { useEffect, useState } from 'react';
import { ChevronRight, File, Folder, FolderOpen, X } from 'lucide-react';
import * as api from '../../api';
import * as settingsStore from '../../state/settingsStore';
import { useSettingsStore } from '../../state/useSettingsStore';
import type { DirEntry } from '../../../shared/workspace';
import { cn } from '../../lib/cn';

export default function DirectoryPanel({ embedded = false }: { embedded?: boolean }) {
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const [root, setRoot] = useState<DirEntry[]>([]);
  const [openDirs, setOpenDirs] = useState<Record<string, DirEntry[]>>({});
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: DirEntry } | null>(null);
  const name = workspacePath?.split(/[/\\]/).filter(Boolean).pop() ?? '工作区';

  async function refresh() {
    const next = await api.listWorkspace();
    setRoot(next);
    const expanded = Object.keys(openDirs);
    const updated: Record<string, DirEntry[]> = {};
    for (const rel of expanded) {
      try {
        updated[rel] = await api.listWorkspace(rel);
      } catch {
        /* gone */
      }
    }
    setOpenDirs(updated);
  }

  useEffect(() => {
    if (!workspacePath) return;
    setPreview(null);
    setOpenDirs({});
    void api
      .listWorkspace()
      .then(setRoot)
      .catch((err) => setError((err as Error).message));
  }, [workspacePath]);

  async function toggleDir(entry: DirEntry) {
    if (openDirs[entry.relativePath]) {
      const next = { ...openDirs };
      delete next[entry.relativePath];
      setOpenDirs(next);
      return;
    }
    const children = await api.listWorkspace(entry.relativePath);
    setOpenDirs((d) => ({ ...d, [entry.relativePath]: children }));
  }

  async function openFile(entry: DirEntry) {
    try {
      const file = await api.readWorkspaceFile(entry.relativePath);
      setPreview({ path: file.relativePath, content: file.content });
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function renderEntries(entries: DirEntry[], depth: number) {
    return entries.map((entry) => (
      <div key={entry.relativePath}>
        <button
          type="button"
          onClick={() => (entry.kind === 'dir' ? void toggleDir(entry) : void openFile(entry))}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, entry });
          }}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] text-ink hover:bg-paper-inset/70"
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          {entry.kind === 'dir' ? (
            <>
              <ChevronRight
                size={12}
                className={cn('shrink-0 text-ink-muted transition', openDirs[entry.relativePath] && 'rotate-90')}
              />
              {openDirs[entry.relativePath] ? (
                <FolderOpen size={13} className="shrink-0 text-ink-muted" />
              ) : (
                <Folder size={13} className="shrink-0 text-ink-muted" />
              )}
            </>
          ) : (
            <>
              <span className="w-3" />
              <File size={13} className="shrink-0 text-ink-muted" />
            </>
          )}
          <span className="truncate">{entry.name}</span>
        </button>
        {entry.kind === 'dir' && openDirs[entry.relativePath] && (
          <div>{renderEntries(openDirs[entry.relativePath], depth + 1)}</div>
        )}
      </div>
    ));
  }

  return (
    <aside className={cn('flex h-full flex-col bg-sidebar', embedded ? 'w-full' : 'w-[260px] shrink-0 border-l border-line')}>
      <div className="flex items-center gap-2 px-3 py-3">
        <FolderOpen size={14} className="shrink-0 text-ink-muted" />
        <span className="flex-1 truncate text-sm font-medium">{name}</span>
        <button type="button" className="text-[11px] text-ink-muted hover:text-ink" onClick={() => void window.reizo.revealInFolder()}>
          打开
        </button>
        <button
          type="button"
          className="text-[11px] text-ink-muted hover:text-ink"
          onClick={async () => {
            const path = await api.pickFolder();
            if (path) await settingsStore.patchSettings({ workspacePath: path });
          }}
        >
          更换
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3" onClick={() => setMenu(null)}>
        {error && <p className="px-2 text-xs text-danger">{error}</p>}
        {renderEntries(root, 0)}
      </div>
      {preview && (
        <div className="flex max-h-[45%] flex-col border-t border-line bg-paper">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="flex-1 truncate text-[11px] text-ink-muted">{preview.path}</span>
            <button type="button" onClick={() => setPreview(null)} className="text-ink-muted hover:text-ink">
              <X size={12} />
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto px-3 pb-3 text-[11px] leading-relaxed text-ink">
            {preview.content}
          </pre>
        </div>
      )}
      {menu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-xl border border-line bg-paper-raised py-1 text-sm shadow-[0_8px_30px_rgba(28,22,18,0.08)]"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left hover:bg-paper-inset"
            onClick={() => {
              void window.reizo.revealInFolder(menu.entry.relativePath);
              setMenu(null);
            }}
          >
            在资源管理器中显示
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left hover:bg-paper-inset"
            onClick={() => {
              void navigator.clipboard.writeText(menu.entry.relativePath);
              setMenu(null);
            }}
          >
            复制路径
          </button>
          {menu.entry.kind === 'dir' && (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left hover:bg-paper-inset"
              onClick={async () => {
                const fileName = window.prompt('新文件名')?.trim();
                if (fileName) {
                  await window.reizo.createWorkspaceEntry(`${menu.entry.relativePath}/${fileName}`, 'file');
                  await refresh();
                }
                setMenu(null);
              }}
            >
              新建文件
            </button>
          )}
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-danger hover:bg-paper-inset"
            onClick={async () => {
              if (window.confirm(`删除 ${menu.entry.relativePath}？`)) {
                await window.reizo.deleteWorkspacePath(menu.entry.relativePath);
                await refresh();
              }
              setMenu(null);
            }}
          >
            删除
          </button>
        </div>
      )}
    </aside>
  );
}
