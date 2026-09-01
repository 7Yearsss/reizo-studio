import { useEffect } from 'react';
import type { PendingPermission } from '../../state/chatStore';
import { ToolApproval } from '../agents/tool-approval';

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

  const parameters = Object.entries(permission.args).map(([key, value]) => ({
    id: key,
    label: key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }));

  return (
    <ToolApproval
      tool={permission.name}
      title="允许运行这个工具？"
      description="高风险动作会先问你，再动文件或命令。"
      parameters={parameters}
      status="pending"
      defaultOpen
      onApprove={() => onRespond('allow')}
      onAlwaysAllow={() => onRespond('allow-session')}
      onDeny={() => onRespond('deny')}
      className="rise-in border-line bg-paper-raised"
    />
  );
}
