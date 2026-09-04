import { useEffect, useState, useCallback } from 'react';
import { FolderOpen, X, ExternalLink, RefreshCw } from 'lucide-react';
import * as api from '../../api';
import * as settingsStore from '../../state/settingsStore';
import { useSettingsStore } from '../../state/useSettingsStore';
import type { DirEntry } from '../../../shared/workspace';
import { cn } from '../../lib/cn';
import { toast } from '../../lib/toast';
import Tooltip from '../ui/Tooltip';
import { FileTree, FileTreeFolder, FileTreeFile } from '../motion/file-tree';
import { CodeBlock } from '../agents/code-block';

function detectLanguage(path: string): any {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'sh':
    case 'bash':
      return 'bash';
    default:
      return 'typescript';
  }
}

export default function DirectoryPanel({ embedded = false }: { embedded?: boolean }) {
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const [root, setRoot] = useState<DirEntry[]>([]);
  const [openDirs, setOpenDirs] = useState<Record<string, DirEntry[]>>({});
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const name = workspacePath?.split(/[/\\]/).filter(Boolean).pop() ?? '工作区';

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
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
      toast.success('工作区文件已刷新');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [openDirs]);

  useEffect(() => {
    if (!workspacePath) return;
    setPreview(null);
    setOpenDirs({});
    setExpandedIds([]);
    api
      .listWorkspace()
      .then(setRoot)
      .catch((err) => setError((err as Error).message));
  }, [workspacePath]);

  const handleExpandedChange = useCallback(
    async (ids: string[]) => {
      setExpandedIds(ids);
      for (const rel of ids) {
        if (!openDirs[rel]) {
          try {
            const children = await api.listWorkspace(rel);
            setOpenDirs((prev) => ({ ...prev, [rel]: children }));
          } catch {
            /* ignore */
          }
        }
      }
    },
    [openDirs],
  );

  const openFile = useCallback(async (relativePath: string) => {
    try {
      const file = await api.readWorkspaceFile(relativePath);
      setPreview({ path: file.relativePath, content: file.content });
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  function renderNode(entry: DirEntry) {
    if (entry.kind === 'dir') {
      const children = openDirs[entry.relativePath] ?? [];
      return (
        <FileTreeFolder key={entry.relativePath} value={entry.relativePath} name={entry.name}>
          {children.map(renderNode)}
        </FileTreeFolder>
      );
    }
    return <FileTreeFile key={entry.relativePath} value={entry.relativePath} name={entry.name} />;
  }

  return (
    <aside
      className={cn(
        'flex h-full flex-col bg-sidebar',
        embedded ? 'w-full' : 'w-[260px] shrink-0 border-l border-line',
      )}
    >
      <div className="flex items-center gap-2 border-b border-line/40 px-3 py-2.5">
        <FolderOpen size={14} className="shrink-0 text-accent" />
        <span className="flex-1 truncate text-xs font-medium text-ink">{name}</span>
        <Tooltip content="在系统资源管理器中打开" side="bottom">
          <button
            type="button"
            className="rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
            onClick={() => void window.reizo.revealInFolder()}
            aria-label="打开文件夹"
          >
            <ExternalLink size={12} />
          </button>
        </Tooltip>
        <Tooltip content="刷新文件" side="bottom">
          <button
            type="button"
            className="rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label="刷新"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-[11px] text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
          onClick={async () => {
            const path = await api.pickFolder();
            if (path) {
              await settingsStore.patchSettings({ workspacePath: path });
              toast.success('已切换工作区');
            }
          }}
        >
          更换
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error && <p className="px-2 py-1 text-xs text-danger">{error}</p>}
        {root.length === 0 && !error ? (
          <p className="px-2 py-4 text-center text-xs text-ink-muted">工作区暂无文件</p>
        ) : (
          <FileTree
            value={preview?.path ?? null}
            onValueChange={(val) => {
              if (val) void openFile(val);
            }}
            expandedIds={expandedIds}
            onExpandedChange={handleExpandedChange}
            ariaLabel="工作区目录树"
          >
            {root.map(renderNode)}
          </FileTree>
        )}
      </div>

      {preview && (
        <div className="flex max-h-[50%] flex-col border-t border-line bg-paper">
          <div className="flex items-center justify-between border-b border-line/40 px-3 py-1.5">
            <span className="truncate font-mono text-[11px] text-ink-muted">{preview.path}</span>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded p-0.5 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
            >
              <X size={12} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <CodeBlock
              code={preview.content}
              language={detectLanguage(preview.path)}
              filename={preview.path.split(/[/\\]/).pop()}
              maxHeight={240}
              showLineNumbers
            />
          </div>
        </div>
      )}
    </aside>
  );
}
