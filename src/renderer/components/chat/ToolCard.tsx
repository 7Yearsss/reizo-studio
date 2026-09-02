import type { ToolCallPart } from '../../../shared/chat';
import { ToolResult, ToolResultOutput } from '../agents/tool-result';
import { toolDetail, toolLabel, toolTarget } from './toolDisplay';

export default function ToolCard({ part }: { part: ToolCallPart }) {
  const running = part.result === undefined && part.error === undefined;
  const detail = toolDetail(part);
  const target = toolTarget(part);
  const kind = part.name === 'run_command' ? 'terminal' : part.name === 'edit_file' || part.name === 'write_file' ? 'custom' : 'request';

  return (
    <ToolResult
      tool={target}
      title={toolLabel(part.name)}
      status={running ? 'running' : part.error ? 'error' : 'success'}
      kind={kind}
      defaultOpen={part.name === 'edit_file' || part.name === 'write_file' || Boolean(part.error)}
      collapseOnComplete={part.name !== 'edit_file' && part.name !== 'write_file'}
      copyText={detail || undefined}
    >
      {detail ? <ToolResultOutput language={kind === 'terminal' ? 'bash' : 'json'}>{detail}</ToolResultOutput> : '（无输出）'}
    </ToolResult>
  );
}
