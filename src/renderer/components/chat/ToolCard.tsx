import type { ToolCallPart } from '../../../shared/chat';
import { ToolResult, ToolResultOutput } from '../agents/tool-result';
import { getResolvedApiOrigin } from '../../api';
import DiffView from './LazyDiffView';
import BatchProgress from './BatchProgress';
import MediaGenerationCard, { isChatMediaTool } from './MediaGenerationCard';
import VideoAnalysisCard from './VideoAnalysisCard';
import DeliverableCard, { deliverableOf } from './DeliverableCard';
import ReviewProposalCard, { reviewProposalOf } from './ReviewProposalCard';
import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import { allowEgressHost, ApiRequestError, rollbackSnapshot } from '../../api';
import { toast } from '../../lib/toast';
import { toolDetail, toolDiffPreview, toolLabel, toolTarget } from './toolDisplay';

function snapshotIdOf(result: string | undefined): string | undefined {
  if (!result) return undefined;
  try { const id = (JSON.parse(result) as { snapshotId?: unknown }).snapshotId; return typeof id === 'string' ? id : undefined; } catch { return undefined; }
}

function blockedHostsOf(result: string | undefined): string[] {
  if (!result) return [];
  try { const hosts = (JSON.parse(result) as { networkBlocked?: unknown }).networkBlocked; return Array.isArray(hosts) ? hosts.filter((h): h is string => typeof h === 'string').slice(0, 5) : []; } catch { return []; }
}

/** Network isolation stopped this command from reaching a host: one click lets it through next time. */
function AllowHostButtons({ hosts }: { hosts: string[] }) {
  const [allowed, setAllowed] = useState<string[]>([]);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
      <span>网络隔离拦下了：</span>
      {hosts.map((host) => (
        <button
          key={host}
          type="button"
          disabled={allowed.includes(host)}
          onClick={() => void allowEgressHost(host).then(() => { setAllowed((list) => [...list, host]); toast.success('已加入允许列表', `${host}，让助手重试即可`); }, () => toast.error('加入失败'))}
          className="rounded-full bg-paper-inset px-2 py-0.5 text-ink hover:bg-paper-inset/70 disabled:opacity-60"
        >
          {allowed.includes(host) ? `${host} 已允许` : `允许 ${host}`}
        </button>
      ))}
    </div>
  );
}

/** "回滚此次修改" under a file diff. Asks first when the file has changed again since. */
function RollbackButton({ sessionId, snapshotId }: { sessionId: string; snapshotId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  async function run(force: boolean): Promise<void> {
    setState('busy');
    try {
      const out = await rollbackSnapshot(sessionId, snapshotId, force);
      setState('done');
      toast.success(out.restored === 'deleted' ? '已删除这次新建的文件' : '已回滚到修改前', out.path);
    } catch (error) {
      setState('idle');
      if (error instanceof ApiRequestError && error.status === 409 && !force) {
        if (window.confirm(`${error.message}\n\n仍要回滚吗？`)) void run(true);
        return;
      }
      toast.error('回滚失败', error instanceof Error ? error.message : undefined);
    }
  }
  return (
    <button type="button" disabled={state !== 'idle'} onClick={() => void run(false)} className="mt-2 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink disabled:opacity-50">
      <Undo2 size={12} /> {state === 'done' ? '已回滚' : '回滚此次修改'}
    </button>
  );
}

export default function ToolCard({ part, collapsed = false, sessionId, interrupted = false }: { part: ToolCallPart; collapsed?: boolean; sessionId?: string; interrupted?: boolean }) {
  const running = part.result === undefined && part.error === undefined;
  if (part.name === 'analyze_video') return <VideoAnalysisCard part={part} interrupted={interrupted} />;
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
  const blockedHosts = part.name === 'run_command' ? blockedHostsOf(part.result) : [];
  const snapshotId = !part.error && (part.name === 'edit_file' || part.name === 'write_file') ? snapshotIdOf(part.result) : undefined;

  return (
    <ToolResult
      tool={target}
      title={toolLabel(part.name, part)}
      status={running ? 'running' : part.error ? 'error' : 'success'}
      kind={kind}
      defaultOpen={!collapsed && (isWrite || Boolean(part.error) || blockedHosts.length > 0)}
      collapseOnComplete={!isWrite}
      copyText={detail || undefined}
    >
      {diffPreview ? (
        <>
          <DiffView preview={diffPreview} />
          {snapshotId && sessionId ? <RollbackButton sessionId={sessionId} snapshotId={snapshotId} /> : null}
        </>
      ) : detail ? (
        <ToolResultOutput language={kind === 'terminal' ? 'bash' : 'json'}>{detail}</ToolResultOutput>
      ) : (
        '（无输出）'
      )}
      {blockedHosts.length > 0 ? <AllowHostButtons hosts={blockedHosts} /> : null}
    </ToolResult>
  );
}
