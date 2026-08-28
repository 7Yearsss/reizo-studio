import { useEffect } from 'react';
import type { PendingPermission } from '../../state/chatStore';

export default function PermissionPrompt({
  permission,
  onRespond,
}: {
  permission: PendingPermission;
  onRespond: (decision: 'allow' | 'deny' | 'allow-session') => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onRespond('deny');
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        onRespond('allow-session');
      } else if (event.key === 'Enter') {
        event.preventDefault();
        onRespond('allow');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRespond]);
  const detail =
    typeof permission.args.command === 'string'
      ? permission.args.command
      : typeof permission.args.path === 'string'
        ? permission.args.path
        : JSON.stringify(permission.args, null, 2).slice(0, 400);

  return (
    <div className="rise-in rounded-[28px] border border-line bg-paper-raised px-5 py-4 shadow-[0_8px_30px_rgba(28,22,18,0.06)]">
      <p className="text-sm font-medium text-ink">允许 {permission.name}？</p>
      <p className="mt-1 text-xs text-ink-muted">高风险动作会先问你，再动文件或命令。</p>
      <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-paper px-3 py-2 text-[12px] leading-relaxed text-ink">
        {detail}
      </pre>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => onRespond('deny')}
          className="rounded-full px-3 py-1.5 text-sm text-ink-muted hover:bg-paper-inset"
        >
          拒绝 Esc
        </button>
        <button
          type="button"
          onClick={() => onRespond('allow-session')}
          className="rounded-full bg-paper-inset px-3 py-1.5 text-sm text-ink hover:opacity-90"
        >
          本会话允许
        </button>
        <button
          type="button"
          onClick={() => onRespond('allow')}
          className="rounded-full bg-accent px-3 py-1.5 text-sm text-accent-ink hover:opacity-90"
        >
          允许一次 Enter
        </button>
      </div>
    </div>
  );
}
