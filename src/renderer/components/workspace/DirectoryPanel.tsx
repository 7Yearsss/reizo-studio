import { useEffect, useRef, useState, useCallback } from 'react';
import { FolderOpen, X, ExternalLink, RefreshCw } from 'lucide-react';
import * as api from '../../api';
import * as settingsStore from '../../state/settingsStore';
import { useSettingsStore } from '../../state/useSettingsStore';
import type { DirEntry } from '../../../shared/workspace';
import { cn } from '../../lib/cn';
import { toast } from '../../lib/toast';
import { Tooltip } from '../ui/Tooltip';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Button } from '../ui/button';
import { FileTree, FileTreeFolder, FileTreeFile } from '../motion/file-tree';
import { CodeBlock, type CodeBlockProps } from '../agents/code-block';

function detectLanguage(path: string): CodeBlockProps['language'] {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
      return 'typescript';
    case 'tsx':
    case 'jsx':
      return 'tsx';
    case 'js':
      return 'typescript';
    case 'json':
      return 'json';
    case 'sh':
    case 'bash':
      return 'bash';
    default:
      return 'text';
  }
}

export default function DirectoryPanel({ embedded = false }: { embedded?: boolean }) {
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const [root, setRoot] = useState<DirEntry[]>([]);
  const [openDirs, setOpenDirs] = useState<Record<string, DirEntry[]>>({});
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ path: string; content: string; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [readingPath, setReadingPath] = useState('');
  const scope = useRef(workspacePath); scope.current = workspacePath;
  const listSequence = useRef(0);
  const fileSequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const name = workspacePath?.split(/[/\\]/).filter(Boolean).pop() ?? '工作区';

  const refresh = useCallback(async () => {
    if (!workspacePath) return;
    const actionScope = workspacePath;
    const sequence = ++listSequence.current;
    setRefreshing(true);
    try {
      const next = await api.listWorkspace();
      const expanded = Object.keys(openDirs);
      const updated: Record<string, DirEntry[]> = {};
      for (const rel of expanded) {
        try {
          updated[rel] = await api.listWorkspace(rel);
        } catch {
          /* gone */
        }
      }
      if (!mounted.current || scope.current !== actionScope || sequence !== listSequence.current) return;
      setRoot(next); setOpenDirs(updated); setError(null);
      toast.success('工作区文件已刷新');
    } catch (err) {
      if (mounted.current && scope.current === actionScope && sequence === listSequence.current) setError((err as Error).message);
    } finally {
      if (mounted.current && scope.current === actionScope && sequence === listSequence.current) setRefreshing(false);
    }
  }, [openDirs, workspacePath]);

  useEffect(() => {
    const sequence = ++listSequence.current;
    ++fileSequence.current;
    setPreview(null); setReadingPath(''); setRoot([]); setError(null); setRefreshing(Boolean(workspacePath));
    setOpenDirs({});
    setExpandedIds([]);
    if (!workspacePath) return;
    let current = true;
    api
      .listWorkspace()
      .then((entries) => { if (current && mounted.current && sequence === listSequence.current) setRoot(entries); })
      .catch((err) => { if (current && mounted.current && sequence === listSequence.current) setError((err as Error).message); })
      .finally(() => { if (current && mounted.current && sequence === listSequence.current) setRefreshing(false); });
    return () => { current = false; };
  }, [workspacePath]);

  const handleExpandedChange = useCallback(
    async (ids: string[]) => {
      const actionScope = workspacePath;
      setExpandedIds(ids);
      for (const rel of ids) {
        if (!openDirs[rel]) {
          try {
            const children = await api.listWorkspace(rel);
            if (mounted.current && scope.current === actionScope) setOpenDirs((prev) => ({ ...prev, [rel]: children }));
          } catch (error) {
            if (mounted.current && scope.current === actionScope) setError(error instanceof Error ? error.message : '目录未能展开');
          }
        }
      }
    },
    [openDirs, workspacePath],
  );

  const openFile = useCallback(async (relativePath: string) => {
    const actionScope = workspacePath;
    const sequence = ++fileSequence.current;
    setReadingPath(relativePath);
    try {
      const file = await api.readWorkspaceFile(relativePath);
      if (!mounted.current || scope.current !== actionScope || sequence !== fileSequence.current) return;
      setPreview({ path: file.relativePath, content: file.content, truncated: file.truncated });
      setError(null);
    } catch (err) {
      if (mounted.current && scope.current === actionScope && sequence === fileSequence.current) setError((err as Error).message);
    } finally {
      if (mounted.current && scope.current === actionScope && sequence === fileSequence.current) setReadingPath('');
    }
  }, [workspacePath]);

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
        'flex h-full flex-col bg-paper-raised',
        embedded ? 'w-full' : 'w-[260px] shrink-0 border-l border-line',
      )}
    >
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-paper-inset text-ink"><FolderOpen size={16} /></span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{name}</span>
        <Tooltip content="在系统资源管理器中打开" side="bottom">
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-[9px] text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink disabled:opacity-50"
            onClick={() => void window.reizo.revealInFolder().catch((error) => setError(error instanceof Error ? error.message : '文件夹未能打开'))}
            disabled={!workspacePath}
            aria-label="打开文件夹"
          >
            <ExternalLink size={14} />
          </button>
        </Tooltip>
        <Tooltip content="刷新文件" side="bottom">
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-[9px] text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink disabled:opacity-50"
            onClick={() => void refresh()}
            disabled={refreshing || !workspacePath}
            aria-label="刷新"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
        <button
          type="button"
          className="h-8 rounded-[9px] px-2.5 text-xs text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink"
          onClick={async () => {
            try {
              const path = await api.pickFolder();
              if (path) { await settingsStore.patchSettings({ workspacePath: path }); toast.success('已切换工作区'); }
            } catch (error) { setError(error instanceof Error ? error.message : '工作区未能切换'); }
          }}
        >
          更换
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error && <Alert variant="destructive"><AlertTitle>读取未完成</AlertTitle><AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{error}{workspacePath ? <Button type="button" variant="ghost" size="xs" disabled={refreshing} onClick={() => void refresh()}>重新读取</Button> : null}</AlertDescription></Alert>}
        {readingPath ? <p role="status" className="px-2 py-2 text-xs text-ink-muted [overflow-wrap:anywhere]">正在读取 {readingPath}</p> : null}
        {root.length === 0 && !error ? (
          <p role={refreshing ? 'status' : undefined} className="px-2 py-4 text-center text-xs text-ink-muted">{refreshing ? '正在读取工作区…' : workspacePath ? '工作区暂无文件' : '选择文件夹后可浏览工作区'}</p>
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
              onClick={() => { ++fileSequence.current; setPreview(null); setReadingPath(''); }}
              aria-label="关闭文件预览"
              className="rounded p-0.5 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
            >
              <X size={12} />
            </button>
          </div>
          {preview.truncated ? <p role="status" className="px-3 py-2 text-xs text-ink-muted">文件预览已截断，仅显示前段内容。</p> : null}
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
