import { useEffect, useState } from 'react';
import { GitBranch, RotateCw } from 'lucide-react';
import { toast } from '../../lib/toast';
import Tooltip from '../ui/Tooltip';
import { CodeBlock } from '../agents/code-block';

interface ParsedGitEntry {
  status: string;
  path: string;
  kind: 'modified' | 'added' | 'deleted' | 'untracked';
}

function parseGitLine(line: string): ParsedGitEntry {
  const status = line.slice(0, 2).trim();
  const path = line.slice(3).trim();
  let kind: ParsedGitEntry['kind'] = 'modified';
  if (status.includes('?') || status === 'A') kind = 'added';
  else if (status.includes('D')) kind = 'deleted';
  else if (status.includes('M')) kind = 'modified';
  else kind = 'untracked';

  return { status, path, kind };
}

export default function GitPanel() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof window.reizo.gitStatus>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh(showToast = false) {
    setLoading(true);
    try {
      const res = await window.reizo.gitStatus();
      setStatus(res);
      setError(null);
      if (showToast) toast.success('Git 状态已更新');
    } catch (err) {
      setError((err as Error).message);
      if (showToast) toast.error('获取 Git 状态失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (error) return <p className="px-3 py-2 text-xs text-danger">{error}</p>;
  if (!status) return <p className="px-3 py-2 text-xs text-ink-muted">读取 Git 状态…</p>;
  if (!status.available) return <p className="px-3 py-2 text-xs text-ink-muted">当前工作区不是 Git 仓库。</p>;

  const lines = status.porcelain
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parseGitLine);

  return (
    <div className="flex h-full flex-col overflow-auto px-3 py-2 text-[12px]">
      <div className="mb-2 flex items-center justify-between border-b border-line/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium text-ink">
          <GitBranch size={13} className="text-accent" />
          <span>{status.branch ?? 'HEAD'}</span>
        </div>
        <Tooltip content="刷新 Git 状态" side="left">
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={loading}
            className="rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors disabled:opacity-50"
          >
            <RotateCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </div>

      <p className="mb-2 text-xs text-ink-muted">
        {status.dirty ? `${lines.length} 处未提交改动` : '工作区干净，无未提交改动'}
      </p>

      {lines.length > 0 && (
        <div className="space-y-1 mb-4">
          {lines.map((item) => {
            const isAdded = item.kind === 'added' || item.kind === 'untracked';
            const isDeleted = item.kind === 'deleted';
            return (
              <div
                key={item.path}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-ink hover:bg-paper-inset/70 transition-colors"
              >
                {isAdded ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-emerald-500/10 text-emerald-600 text-[10px] font-bold">
                    +
                  </span>
                ) : isDeleted ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-rose-500/10 text-rose-600 text-[10px] font-bold">
                    −
                  </span>
                ) : (
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-amber-500/10 text-amber-600 text-[10px] font-bold">
                    M
                  </span>
                )}
                <span className="truncate flex-1 font-mono text-[11px]">{item.path}</span>
                <span className="text-[10px] text-ink-muted uppercase">{item.status}</span>
              </div>
            );
          })}
        </div>
      )}

      {status.recent && (
        <div className="mt-2 border-t border-line/40 pt-2">
          <p className="mb-1 text-[11px] font-medium text-ink-muted">最近提交</p>
          <CodeBlock
            code={status.recent}
            language="bash"
            showLineNumbers={false}
            maxHeight={180}
            copyable={false}
          />
        </div>
      )}
    </div>
  );
}
