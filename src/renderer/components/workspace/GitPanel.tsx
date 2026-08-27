import { useEffect, useState } from 'react';

export default function GitPanel() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof window.reizo.gitStatus>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setStatus(await window.reizo.gitStatus());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (error) return <p className="px-3 py-2 text-xs text-danger">{error}</p>;
  if (!status) return <p className="px-3 py-2 text-xs text-ink-muted">读取 git…</p>;
  if (!status.available) return <p className="px-3 py-2 text-xs text-ink-muted">当前工作区不是 git 仓库。</p>;

  const lines = status.porcelain.split('\n').map((line) => line.trimEnd()).filter(Boolean);

  return (
    <div className="flex h-full flex-col overflow-auto px-3 py-2 text-[12px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-ink">{status.branch ?? 'HEAD'}</span>
        <button type="button" onClick={() => void refresh()} className="text-[11px] text-ink-muted hover:text-ink">
          刷新
        </button>
      </div>
      <p className="mb-2 text-ink-muted">{status.dirty ? `${lines.length} 处未提交改动` : '工作区干净'}</p>
      {lines.map((line) => (
        <pre key={line} className="whitespace-pre-wrap text-ink">
          {line}
        </pre>
      ))}
      {status.recent && (
        <div className="mt-3 border-t border-line pt-2">
          <p className="mb-1 text-ink-muted">最近提交</p>
          <pre className="whitespace-pre-wrap text-ink">{status.recent}</pre>
        </div>
      )}
    </div>
  );
}
