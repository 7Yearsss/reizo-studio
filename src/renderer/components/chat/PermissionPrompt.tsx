import { useEffect } from 'react';
import { CANVAS_BUDGET_TOOL } from '../../../shared/stream';
import type { PendingPermission } from '../../state/chatStore';
import { ToolApproval } from '../agents/tool-approval';
import DiffView from './LazyDiffView';

/** Params whose value is already shown by the diff view — hide them from the list. */
const DIFF_REDUNDANT_KEYS = new Set(['content', 'oldString', 'newString', 'path']);

export default function PermissionPrompt({
  permission,
  onRespond,
}: {
  permission: PendingPermission;
  onRespond: (decision: 'allow' | 'deny' | 'allow-session' | 'allow-always') => void;
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

  const isConfirm = permission.name === 'computer_confirm' || permission.name === 'create_schedule' || permission.name === 'delete_schedule';
  const confirmLabel = typeof permission.args.label === 'string' ? permission.args.label : '';
  const confirmSummary = typeof permission.args.summary === 'string' ? permission.args.summary : '';
  const parameters = (permission.name === 'computer_confirm'
    ? Object.entries({ 操作类型: confirmLabel, 说明: confirmSummary || '（模型未给出说明）' })
    : Object.entries(permission.args))
    .filter(([key]) => !preview || !DIFF_REDUNDANT_KEYS.has(key))
    .map(([key, value]) => ({
      id: key,
      label: key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }));

  const isComputer = permission.name === 'computer';
  const isCanvasBudget = permission.name === CANVAS_BUDGET_TOOL;
  const mcp = /^mcp__([A-Za-z0-9-]+)__(.+)$/.exec(permission.name);
  const executed = typeof permission.args.executed === 'number' ? permission.args.executed : null;
  const planned = typeof permission.args.planned === 'number' ? permission.args.planned : null;
  const title = preview
    ? `允许写入 ${preview.path}？`
    : permission.name === 'http_fetch'
      ? `允许访问网页 ${typeof permission.args.url === 'string' ? permission.args.url.replace(/^https?:\/\//, '').slice(0, 60) : ''}？`
    : permission.name === 'web_search'
      ? `允许联网搜索「${typeof permission.args.query === 'string' ? permission.args.query.slice(0, 40) : ''}」？`
    : permission.name === 'computer_confirm'
      ? `Agent 要${confirmLabel || '执行一个不可撤回的操作'}，允许吗？`
      : permission.name === 'create_schedule'
        ? '允许 Agent 创建一个自动化任务？'
        : permission.name === 'delete_schedule'
          ? '允许 Agent 删除一个自动化任务？'
    : isComputer
      ? '允许 Agent 操作这台电脑？'
      : isCanvasBudget
        ? planned != null
          ? `计划运行 ${planned} 个画布节点，超出本轮配额——继续吗？`
          : `已生成 ${executed ?? ''} 个画布任务，继续生成更多吗？`
        : mcp
          ? `允许调用外部 MCP 工具 ${mcp[1]} / ${mcp[2]}？`
          : '允许运行这个工具？';
  const description = isConfirm
    ? '这类操作会留下长期影响或无法撤回，每一次都需要你确认，没有“本会话都允许”。'
    : mcp
    ? '这是你配置的第三方 MCP 服务，它返回的内容不受信任。选“本会话都允许”后，这个工具在本会话内不再询问；也可以选“以后一律允许”，之后重启也不再询问。'
    : isComputer
    ? '同意后，本次会话中 Agent 可以截屏并控制鼠标、键盘，直到会话结束。不要让它输入密码等敏感信息。'
    : isCanvasBudget
      ? '画布生成有每轮配额。允许一次会再放行一批；本会话都允许则本轮内不再询问。'
      : '高风险动作会先问你，再动文件或命令。';

  return (
    <div className="rise-in space-y-2">
      {preview ? <DiffView preview={preview} /> : null}
      {mcp && (
        <button type="button" onClick={() => onRespond('allow-always')} className="px-1 text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline">
          以后一律允许这个工具（可在设置里撤销）
        </button>
      )}
      <ToolApproval
        tool={permission.name}
        title={title}
        description={description}
        parameters={parameters}
        status="pending"
        defaultOpen={!preview}
        onApprove={() => onRespond('allow')}
        onAlwaysAllow={isConfirm ? undefined : () => onRespond('allow-session')}
        onDeny={() => onRespond('deny')}
        className="border-line bg-paper-raised"
      />
    </div>
  );
}
