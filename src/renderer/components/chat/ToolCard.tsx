import type { ToolCallPart } from '../../../shared/chat';
import { ToolResult, ToolResultOutput } from '../agents/tool-result';
import { getResolvedApiOrigin } from '../../api';
import DiffView from './LazyDiffView';
import BatchProgress from './BatchProgress';
import MediaGenerationCard, { isChatMediaTool } from './MediaGenerationCard';
import DeliverableCard, { deliverableOf } from './DeliverableCard';
import ReviewProposalCard, { reviewProposalOf } from './ReviewProposalCard';
import { toolDetail, toolDiffPreview, toolLabel, toolTarget } from './toolDisplay';

export default function ToolCard({ part, collapsed = false, sessionId, interrupted = false }: { part: ToolCallPart; collapsed?: boolean; sessionId?: string; interrupted?: boolean }) {
  const running = part.result === undefined && part.error === undefined;
  if (isChatMediaTool(part.name)) return <MediaGenerationCard part={part} sessionId={sessionId} interrupted={interrupted} />;

  if (part.name === 'run_batch') {
    const count = Array.isArray(part.args?.tasks) ? (part.args.tasks as unknown[]).length : 0;
    return <BatchProgress id={part.id} tasks={count} />;
  }

  if (part.name === 'computer') {
    let shot = '';
    let summary = typeof part.args?.action === 'string' ? (part.args.action as string) : '操作电脑';
    if (part.result) {
      try {
        const parsed = JSON.parse(part.result) as Record<string, unknown>;
        if (typeof parsed.screenshotUrl === 'string') shot = parsed.screenshotUrl;
        if (typeof parsed.summary === 'string') summary = parsed.summary;
      } catch {
        /* raw */
      }
    }
    if (shot && !shot.startsWith('http') && !shot.startsWith('data:')) {
      const origin = getResolvedApiOrigin() || 'http://127.0.0.1:47100';
      shot = shot.startsWith('/') ? `${origin}${shot}` : `${origin}/${shot}`;
    }
    return (
      <ToolResult
        tool={summary}
        title={toolLabel('computer', part)}
        status={running ? 'running' : part.error ? 'error' : 'success'}
        kind="request"
        defaultOpen={!collapsed}
        collapseOnComplete={false}
        copyText={part.error || part.result || undefined}
      >
        {part.error ? (
          <ToolResultOutput language="json">{part.error}</ToolResultOutput>
        ) : shot ? (
          <img
            src={shot}
            alt={summary}
            className="max-h-[420px] w-full rounded-md border border-line object-contain"
          />
        ) : (
          '（无截图）'
        )}
      </ToolResult>
    );
  }

  const proposal = reviewProposalOf(part);
  if (proposal) return <ReviewProposalCard proposal={proposal} />;

  const deliverable = deliverableOf(part);
  if (deliverable) return <DeliverableCard part={part} file={deliverable} />;

  const detail = toolDetail(part);
  const target = toolTarget(part);
  const diffPreview = part.error ? null : toolDiffPreview(part);
  const kind = part.name === 'run_command' ? 'terminal' : part.name === 'edit_file' || part.name === 'write_file' ? 'custom' : 'request';
  const isWrite = part.name === 'edit_file' || part.name === 'write_file' || part.name === 'memory_write';

  return (
    <ToolResult
      tool={target}
      title={toolLabel(part.name, part)}
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
