import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { CANVAS_BUDGET_TOOL } from '../../../shared/stream';
import type { PendingPermission } from '../../state/chatStore';
import { ToolApproval } from '../agents/tool-approval';
import DiffView from './LazyDiffView';
import { approvalKeyAction } from '../../../shared/approvalKeys';
import { assessRisk, hasHiddenChars, revealHiddenChars, RISK_LABEL } from '../../../shared/permissionRisk';

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
      const el = event.target instanceof HTMLElement ? event.target : null;
      const action = approvalKeyAction({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        isComposing: event.isComposing,
        defaultPrevented: event.defaultPrevented,
        target: el ? { tag: el.tagName, role: el.getAttribute('role'), editable: el.isContentEditable } : null,
      });
      if (!action) return;
      event.preventDefault();
      onRespond(action);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRespond]);

  // A long approval can cover the conversation it is asking about: fold it to one line, keep it answerable.
  const [minimized, setMinimized] = useState(false);
  useEffect(() => { setMinimized(false); }, [permission.id]);

  const preview = permission.preview ?? null;

  const isConfirm = permission.name === 'computer_confirm' || permission.name === 'create_schedule' || permission.name === 'delete_schedule' || permission.name === 'propose_skill' || permission.name === 'computer_app';
  const confirmLabel = typeof permission.args.label === 'string' ? permission.args.label : '';
  const confirmSummary = typeof permission.args.summary === 'string' ? permission.args.summary : '';
  const parameters = (permission.name === 'computer_confirm'
    ? Object.entries({ 操作类型: confirmLabel, 说明: confirmSummary || '（模型未给出说明）' })
    : Object.entries(permission.args))
    .filter(([key]) => !preview || !DIFF_REDUNDANT_KEYS.has(key))
    .map(([key, value]) => ({
      id: key,
      label: key,
      value: revealHiddenChars(typeof value === 'string' ? value : JSON.stringify(value)),
    }));
  const risks = assessRisk(permission.name, permission.args);
  const hidden = Object.values(permission.args).some((value) => typeof value === 'string' && hasHiddenChars(value));

  const isComputer = permission.name === 'computer';
  const isCanvasBudget = permission.name === CANVAS_BUDGET_TOOL;
  const mcp = /^mcp__([A-Za-z0-9-]+)__(.+)$/.exec(permission.name);
  const executed = typeof permission.args.executed === 'number' ? permission.args.executed : null;
  const planned = typeof permission.args.planned === 'number' ? permission.args.planned : null;
  const title = preview
    ? `允许写入 ${preview.path}？`
    : permission.name === 'analyze_video'
      ? '允许读取并分析这个视频？'
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
          : permission.name === 'computer_app'
            ? `允许 Agent 操作${typeof permission.args.kind === 'string' ? permission.args.kind : '应用'}「${typeof permission.args.app === 'string' ? permission.args.app : ''}」？`
          : permission.name === 'propose_skill'
            ? `保存为技能「${typeof permission.args.name === 'string' ? permission.args.name : ''}」${typeof permission.args.updateId === 'string' ? '（更新已有）' : ''}？`
    : isComputer
      ? '允许 Agent 操作这台电脑？'
      : isCanvasBudget
        ? planned != null
          ? `计划运行 ${planned} 个画布节点，超出本轮配额——继续吗？`
          : `已生成 ${executed ?? ''} 个画布任务，继续生成更多吗？`
        : mcp
          ? `允许调用外部 MCP 工具 ${mcp[1]} / ${mcp[2]}？`
          : '允许运行这个工具？';
  const description = permission.name === 'analyze_video'
    ? `${permission.args.signedIn ? '使用你在内置浏览器保存的网站登录状态。' : ''}视频关键帧和可用字幕将交给当前对话模型分析。`
    : isConfirm
    ? '这类操作会留下长期影响或无法撤回，每一次都需要你确认，没有“本会话都允许”。'
    : mcp
    ? '这是你配置的第三方 MCP 服务，它返回的内容不受信任。选“本会话都允许”后，这个工具在本会话内不再询问；也可以选“以后一律允许”，之后重启也不再询问。'
    : isComputer
    ? '同意后，本次会话中 Agent 可以截屏并控制鼠标、键盘，直到会话结束。不要让它输入密码等敏感信息。'
    : isCanvasBudget
      ? '画布生成有每轮配额。允许一次会再放行一批；本会话都允许则本轮内不再询问。'
      : '高风险动作会先问你，再动文件或命令。';

  if (minimized) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-paper-raised px-3 py-1.5 text-[12px]" role="group" aria-label="待批准的操作（已折叠）">
        <span className="min-w-0 flex-1 truncate text-ink" title={title}>{title}</span>
        <button type="button" onClick={() => setMinimized(false)} className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"><ChevronUp size={12} />展开</button>
        <button type="button" onClick={() => onRespond('deny')} className="rounded-full border border-line px-2.5 py-0.5 text-ink hover:bg-paper-inset">拒绝</button>
        <button type="button" onClick={() => onRespond('allow')} className="rounded-full bg-ink px-2.5 py-0.5 text-paper-raised hover:opacity-85">允许</button>
      </div>
    );
  }

  return (
    <div className="rise-in space-y-2">
      <button type="button" onClick={() => setMinimized(true)} className="ml-auto flex items-center gap-1 px-1 text-[11px] text-ink-muted hover:text-ink" aria-label="折叠审批卡片"><ChevronDown size={12} />折叠</button>
      {preview ? <DiffView preview={preview} /> : null}
      {risks.length || hidden ? (
        <div className="flex flex-wrap gap-1.5 px-1" aria-label="风险提示">
          {risks.map((tag) => (
            <span key={tag} className="rounded-full bg-paper-inset px-2 py-0.5 text-[11px] text-ink">{RISK_LABEL[tag]}</span>
          ))}
          {hidden ? <span className="rounded-full bg-paper-inset px-2 py-0.5 text-[11px] text-danger">含不可见字符，已显示为 &lt;U+XXXX&gt;</span> : null}
        </div>
      ) : null}
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
