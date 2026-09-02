import { useEffect } from 'react';
import type { PendingPermission } from '../../state/chatStore';
import { ToolApproval } from '../agents/tool-approval';
import DiffView from './DiffView';

/** Params whose value is already shown by the diff view — hide them from the list. */
const DIFF_REDUNDANT_KEYS = new Set(['content', 'oldString', 'newString', 'path']);

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

  const preview = permission.preview ?? null;

  const parameters = Object.entries(permission.args)
    .filter(([key]) => !preview || !DIFF_REDUNDANT_KEYS.has(key))
    .map(([key, value]) => ({
      id: key,
      label: key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }));

  const title = preview
    ? `允许写入 ${preview.path}？`
    : '允许运行这个工具？';

  return (
    <div className="rise-in space-y-2">
      {preview ? <DiffView preview={preview} /> : null}
      <ToolApproval
        tool={permission.name}
        title={title}
        description="高风险动作会先问你，再动文件或命令。"
        parameters={parameters}
        status="pending"
        defaultOpen={!preview}
        onApprove={() => onRespond('allow')}
        onAlwaysAllow={() => onRespond('allow-session')}
        onDeny={() => onRespond('deny')}
        className="border-line bg-paper-raised"
      />
    </div>
  );
}
