import { Film, LoaderCircle, CircleAlert, Check } from 'lucide-react';
import type { ToolCallPart } from '../../../shared/chat';

function timestamp(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export default function VideoAnalysisCard({ part, interrupted = false }: { part: ToolCallPart; interrupted?: boolean }) {
  let result: { kind?: string; error?: string; title?: string; duration?: number; frames?: unknown[]; audio?: string } = {};
  try { if (part.result) result = JSON.parse(part.result); } catch { /* An incomplete legacy result is not success. */ }
  const error = part.error || result.error;
  const complete = result.kind === 'video-analysis' && Array.isArray(result.frames) && result.frames.length > 0;
  const running = !error && !part.result && !interrupted;
  const Icon = running ? LoaderCircle : error || interrupted || !complete ? CircleAlert : Check;
  let host = '';
  try { host = new URL(String(part.args.url ?? '')).hostname; } catch { /* No valid source yet. */ }
  return <div role="status" aria-busy={running} className="my-2 rounded-xl border border-line bg-paper-raised px-4 py-3 text-sm">
    <div className="flex items-center gap-2">
      <Icon size={16} className={running ? 'animate-spin text-ink-muted' : error ? 'text-destructive' : 'text-ink-muted'} />
      <span className="font-medium">{running ? '正在分析视频' : error ? '视频分析失败' : interrupted && !complete ? '视频分析已中断' : complete ? '已读取视频画面' : '未读取到视频画面'}</span>
      {host && <span className="ml-auto truncate text-xs text-ink-muted">{host}</span>}
    </div>
    {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : complete ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
      <Film size={13} />
      {typeof result.duration === 'number' && <span>{timestamp(result.duration)}</span>}
      <span>{result.frames.length} 帧</span>
      <span>{result.audio === 'captions-only' ? '已读取字幕' : '无可读字幕'}</span>
      <span>音频未转写</span>
    </div> : null}
  </div>;
}
