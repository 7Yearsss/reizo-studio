import type { ToolCallPart } from '../../../shared/chat';
import { ToolResult, ToolResultOutput } from '../agents/tool-result';
import DiffView from './DiffView';
import { toolDetail, toolDiffPreview, toolLabel, toolTarget } from './toolDisplay';

export default function ToolCard({ part, collapsed = false }: { part: ToolCallPart; collapsed?: boolean }) {
  const running = part.result === undefined && part.error === undefined;
  const detail = toolDetail(part);
  const target = toolTarget(part);
  const diffPreview = part.error ? null : toolDiffPreview(part);
  const kind = part.name === 'run_command' ? 'terminal' : part.name === 'edit_file' || part.name === 'write_file' ? 'custom' : 'request';
  const isWrite = part.name === 'edit_file' || part.name === 'write_file' || part.name === 'memory_write';

  return (
    <ToolResult
      tool={target}
      title={toolLabel(part.name)}
      status={running ? 'running' : part.error ? 'error' : 'success'}
      kind={kind}
      defaultOpen={!collapsed && (isWrite || Boolean(part.error))}
      collapseOnComplete={!isWrite}
      copyText={detail || undefined}
    >
      {diffPreview ? (
        <DiffView preview={diffPreview} />
      ) : detail ? (
        <ToolResultOutput language={kind === 'terminal' ? 'bash' : 'json'}>{detail}</ToolResultOutput>
      ) : (
        '（无输出）'
      )}
    </ToolResult>
  );
}
