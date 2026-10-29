import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { Schedule, Thought } from '../../shared/schedule';
import { SCHEDULE_PRESETS, describeCadence, type RunPermission, type ScheduleCadence } from '../../shared/schedule';
import * as api from '../api';
import * as chatStore from '../state/chatStore';
import * as tabStore from '../state/tabStore';
import * as uiStore from '../state/uiStore';
import { useSkillStore } from '../state/useSkillStore';
import { cn } from '../lib/cn';
import { nanoid } from 'nanoid';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { pausedRepairHint, runOutcomeDisplay } from '../../shared/scheduleOutcome';

export default function AutomationPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [prompt, setPrompt] = useState('');
  const [thoughtDraft, setThoughtDraft] = useState('');
  const [intervalMs, setIntervalMs] = useState(SCHEDULE_PRESETS[2].intervalMs);
  const [when, setWhen] = useState<'interval' | 'folder' | ScheduleCadence['kind']>('interval');
  const [watchFolder, setWatchFolder] = useState('');
  const [watchPattern, setWatchPattern] = useState('');
  const [runPermission, setRunPermission] = useState<RunPermission>('readonly');
  const [clock, setClock] = useState('09:00');
  const [weekday, setWeekday] = useState(1);
  const cadence: ScheduleCadence | undefined = when === 'interval' || when === 'folder' ? undefined : {
    kind: when, hour: Number(clock.split(':')[0]) || 0, minute: Number(clock.split(':')[1]) || 0, ...(when === 'weekly' ? { dayOfWeek: weekday } : {}),
  };
  const skills = useSkillStore().skills;
  const [skillId, setSkillId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const readSequence = useRef(0);
  const createAttempt = useRef<{ signature: string; id: string } | null>(null);
  const runAttempts = useRef(new Map<string, string>());
  const promptRevision = useRef(0);
  const thoughtRevision = useRef(0);
  const [confirmRun, setConfirmRun] = useState('');

  const refresh = useCallback(async (background = false) => {
    const sequence = ++readSequence.current;
    if (!background) setLoading(true);
    const [scheduleData, thoughtData] = await Promise.allSettled([api.listSchedules(), api.listThoughts()]);
    if (!mounted.current || sequence !== readSequence.current) return;
    if (scheduleData.status === 'fulfilled') {
      setSchedules(scheduleData.value.schedules);
      for (const schedule of scheduleData.value.schedules) {
        const id = runAttempts.current.get(schedule.id);
        if (id && [schedule.pendingRun?.operationId, schedule.activeExecution?.operationId, schedule.lastRunOperationId].includes(id)) { runAttempts.current.delete(schedule.id); setConfirmRun((current) => current === schedule.id ? '' : current); }
      }
    }
    if (thoughtData.status === 'fulfilled') setThoughts(thoughtData.value);
    const failed = [scheduleData, thoughtData].find((result) => result.status === 'rejected');
    setReadError(failed?.status === 'rejected' ? failed.reason instanceof Error ? failed.reason.message : '列表读取失败，请重试' : '');
    setLoading(false);
  }, []);

  const perform = async (key: string, action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(key); setError('');
    try { await action(); }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : '操作未完成，请重试'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(''); }
  };

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden' && !inFlight.current) void refresh(true); }, 15_000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [refresh]);

  return (
    <div className="flex h-full min-w-0">
      <section className="flex w-[320px] shrink-0 flex-col border-r border-line bg-sidebar">
        <header className="px-4 py-4">
          <h1 className="text-lg font-semibold">想法</h1>
          <p className="mt-1 text-xs text-ink-muted">先记下来，再派给 Agent。</p>
        </header>
        <div className="px-3 pb-3">
          <textarea
            aria-label="新想法"
            value={thoughtDraft}
            onChange={(e) => { ++thoughtRevision.current; setThoughtDraft(e.target.value); }}
            placeholder="记一条想法…"
            rows={3}
            className="w-full resize-none rounded-2xl bg-paper px-3 py-2 text-sm text-ink outline-none"
          />
          <button
            type="button"
            className="mt-2 text-xs text-accent"
            disabled={!thoughtDraft.trim() || Boolean(busy)}
            onClick={() => void perform('thought:create', async () => {
              if (!thoughtDraft.trim()) return;
              const revision = thoughtRevision.current;
              const thought = await api.createThought(thoughtDraft.trim());
              if (!mounted.current) return;
              ++readSequence.current; setThoughts((current) => [thought, ...current]);
              if (thoughtRevision.current === revision) setThoughtDraft('');
              await refresh();
            })}
          >
            {busy === 'thought:create' ? '正在保存' : '保存想法'}
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-4">
          {loading && !thoughts.length ? <p role="status" className="px-1 text-xs text-ink-muted">正在读取想法…</p> : null}
          {thoughts.map((thought) => (
            <div key={thought.id} className="rounded-2xl border border-line bg-paper-raised p-3">
              <p className="text-sm text-ink">{thought.content}</p>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  className="text-[11px] text-accent"
                  disabled={Boolean(busy)}
                  onClick={() => void perform(`thought:${thought.id}`, async () => {
                    const session = await chatStore.createSession(thought.content.slice(0, 40));
                    uiStore.setMode('chat');
                    tabStore.openChatTab(session.id, session.title);
                    void chatStore.sendMessage(session.id, thought.content);
                  })}
                >
                  讨论
                </button>
                <button
                  type="button"
                  className="text-[11px] text-danger"
                  disabled={Boolean(busy)}
                  onClick={() => void perform(`thought:${thought.id}`, async () => {
                    await api.deleteThought(thought.id);
                    if (!mounted.current) return;
                    ++readSequence.current; setThoughts((current) => current.filter((item) => item.id !== thought.id));
                    await refresh();
                  })}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold">自动化</h1>
            <p className="mt-1 text-xs text-ink-muted">按间隔在本机调度，使用当前模型供应商，费用以其账单为准。</p>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="刷新自动化和想法" disabled={loading || Boolean(busy)} onClick={() => void refresh()}><RefreshCw /></Button>
        </header>
        {error || readError ? <div className="px-6 pb-3"><Alert variant="destructive"><AlertTitle>{error ? '操作未完成' : '自动化列表未能更新'}</AlertTitle><AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{error || readError}<Button type="button" variant="ghost" size="xs" disabled={loading || Boolean(busy)} onClick={() => { setError(''); void refresh(); }}>重新读取</Button></AlertDescription></Alert></div> : null}
        <div className="border-b border-line px-6 pb-4">
          <textarea
            aria-label="自动化任务内容"
            value={prompt}
            onChange={(e) => { ++promptRevision.current; setPrompt(e.target.value); }}
            placeholder="到期后让 Agent 做什么…"
            rows={2}
            className="w-full resize-none rounded-2xl bg-sidebar px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              aria-label="自动化运行方式"
              value={when}
              onChange={(e) => setWhen(e.target.value as typeof when)}
              className="rounded-full bg-sidebar px-3 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="interval">按间隔</option>
              <option value="weekdays">工作日</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="folder">有新文件时</option>
            </select>
            {when === 'weekly' && (
              <select
                aria-label="每周几运行"
                value={weekday}
                onChange={(e) => setWeekday(Number(e.target.value))}
                className="rounded-full bg-sidebar px-3 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {['日', '一', '二', '三', '四', '五', '六'].map((name, index) => <option key={index} value={index}>周{name}</option>)}
              </select>
            )}
            {when === 'folder' && (
              <>
                <input
                  aria-label="监听的文件夹（工作区内的相对路径）"
                  placeholder="文件夹，如 inbox"
                  value={watchFolder}
                  onChange={(e) => setWatchFolder(e.target.value)}
                  className="w-36 rounded-full bg-sidebar px-3 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <input
                  aria-label="只关注这类文件"
                  placeholder="如 *.pdf（可空）"
                  value={watchPattern}
                  onChange={(e) => setWatchPattern(e.target.value)}
                  className="w-32 rounded-full bg-sidebar px-3 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </>
            )}
            {when !== 'interval' && when !== 'folder' && (
              <input
                type="time"
                aria-label="运行时间"
                value={clock}
                onChange={(e) => setClock(e.target.value)}
                className="rounded-full bg-sidebar px-3 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
            {when === 'interval' && <select
              aria-label="自动化运行间隔"
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              className="rounded-full bg-sidebar px-3 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {SCHEDULE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.intervalMs}>
                  {preset.label}
                </option>
              ))}
            </select>}
            <select
              aria-label="自动化权限"
              value={runPermission}
              onChange={(e) => setRunPermission(e.target.value as RunPermission)}
              title="无人值守时 Agent 最多能做什么；不会超过全局权限设置"
              className="rounded-full bg-sidebar px-3 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="readonly">只读分析</option>
              <option value="workspace">可改工作区文件</option>
              <option value="inherit">沿用全局权限</option>
            </select>
            <select
              aria-label="自动化使用的技能"
              value={skillId}
              onChange={(e) => setSkillId(e.target.value)}
              className="rounded-full bg-sidebar px-3 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">不绑定技能</option>
              {skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  /{skill.id}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-xs text-paper-raised"
              disabled={!prompt.trim() || Boolean(busy) || (when === 'folder' && !watchFolder.trim())}
              onClick={() => void perform('schedule:create', async () => {
                if (!prompt.trim()) return;
                const input = { prompt: prompt.trim(), intervalMs: cadence ? 24 * 60 * 60 * 1000 : intervalMs, skillId: skillId || undefined, runPermission, ...(cadence ? { cadence } : {}), ...(when === 'folder' ? { watch: { folder: watchFolder.trim(), ...(watchPattern.trim() ? { pattern: watchPattern.trim() } : {}) } } : {}) };
                const signature = JSON.stringify(input);
                if (!createAttempt.current || createAttempt.current.signature !== signature) createAttempt.current = { signature, id: nanoid() };
                const revision = promptRevision.current;
                const schedule = await api.createSchedule({ ...input, operationId: createAttempt.current.id });
                if (!mounted.current) return;
                ++readSequence.current; setSchedules((current) => [schedule, ...current.filter((item) => item.id !== schedule.id)]);
                createAttempt.current = null;
                if (promptRevision.current === revision) setPrompt('');
                await refresh();
              })}
            >
              <Plus size={12} />
              {busy === 'schedule:create' ? '正在创建' : '新建自动化'}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto px-6 py-4">
          {schedules.length === 0 && <p role={loading ? 'status' : undefined} className="text-sm text-ink-muted">{loading ? '正在读取自动化…' : readError ? '重新读取后可查看已有自动化。' : '还没有定时任务。'}</p>}
          {schedules.map((schedule) => (
            <div key={schedule.id} className="rounded-2xl border border-line bg-paper-raised p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{schedule.name}</p>
                  <p className="mt-1 text-sm text-ink-muted">{schedule.prompt}</p>
                  <p className="mt-2 text-[11px] text-ink-muted">
                    {!Number.isSafeInteger(schedule.intervalMs) || schedule.intervalMs < 60_000 ? '配置无效，不会运行' : schedule.activeExecution ? '执行中' : schedule.pendingRun ? '等待手动执行' : schedule.lastOutcome === 'interrupted' && !schedule.enabled ? '已中断并暂停' : schedule.enabled ? '已启用' : '已暂停'}{schedule.watch ? ` · 监听 ${schedule.watch.folder}${schedule.watch.pattern ? `/${schedule.watch.pattern}` : ''}` : schedule.enabled && !schedule.activeExecution && !schedule.pendingRun ? ` · 下次 ${new Date(schedule.nextRunAt).toLocaleString()}` : ''} · 已尝试 {schedule.runCount} 次{schedule.cadence ? ` · ${describeCadence(schedule.cadence)}` : ''} · {schedule.runPermission === 'readonly' ? '只读' : schedule.runPermission === 'inherit' ? '沿用全局权限' : '可改工作区文件'}{schedule.once ? ' · 仅运行一次' : ''}
                    {schedule.lastError ? ` · 上次失败：${schedule.lastError}` : ''}
                  </p>
                  {(schedule.activeExecution ? schedule.activeExecution.sessionId : schedule.lastSessionId) ? <Button type="button" variant="ghost" size="xs" className="mt-2" onClick={() => { const sessionId = schedule.activeExecution ? schedule.activeExecution.sessionId : schedule.lastSessionId; if (!sessionId) return; uiStore.setMode('chat'); tabStore.openChatTab(sessionId, schedule.name); }}>{schedule.activeExecution ? '查看本次会话' : '查看上次结果'}</Button> : null}
                  {schedule.runs?.length ? (
                    <details className="mt-2 text-xs text-ink-muted">
                      <summary className="cursor-pointer select-none hover:text-ink">运行记录（{schedule.runs.length}）</summary>
                      <ul className="mt-1 space-y-1">
                        {schedule.runs.map((run) => (
                          <li key={run.executionId} className="flex items-center gap-2">
                            <span className={runOutcomeDisplay(run.outcome).tone === 'danger' ? 'text-danger' : 'text-ink'}>{runOutcomeDisplay(run.outcome).label}</span>
                            <span>{new Date(run.startedAt).toLocaleString()}{run.kind === 'manual' ? ' · 手动' : ''}</span>
                            {run.error ? <span className="min-w-0 flex-1 truncate" title={run.error}>{run.error}</span> : <span className="flex-1" />}
                            {run.sessionId ? <button type="button" className="shrink-0 underline-offset-2 hover:text-ink hover:underline" onClick={() => { uiStore.setMode('chat'); tabStore.openChatTab(run.sessionId!, schedule.name); }}>查看会话</button> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {schedule.autoPausedAt && !schedule.enabled ? <p className="mt-2 text-xs leading-relaxed text-danger">已因连续失败自动暂停，说明、计划和历史不变。{pausedRepairHint(schedule.lastError)}</p> : null}
                  {schedule.lastOutcome === 'interrupted' && !schedule.activeExecution ? <p className="mt-2 text-xs leading-relaxed text-ink-muted">上次结果尚未确认，未自动重新提交。先查看关联会话，再决定是否重试。</p> : null}
                  {confirmRun === schedule.id && !schedule.activeExecution && !schedule.pendingRun ? <div className="mt-3 flex flex-col gap-2 rounded-lg bg-paper p-3"><p className="text-xs leading-relaxed text-ink-muted">按当前自动化配置手动运行一次，可能产生模型费用。已暂停的周期计划保持暂停。</p><div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="xs" disabled={Boolean(busy)} onClick={() => setConfirmRun('')} autoFocus>取消</Button><Button type="button" size="xs" disabled={Boolean(busy)} onClick={() => void perform(`schedule:${schedule.id}`, async () => {
                    let id = runAttempts.current.get(schedule.id); if (!id) { id = nanoid(); runAttempts.current.set(schedule.id, id); }
                    const updated = await api.requestScheduleRun(schedule.id, id);
                    if (!mounted.current) return;
                    runAttempts.current.delete(schedule.id); setConfirmRun('');
                    ++readSequence.current; setSchedules((current) => current.map((item) => item.id === updated.id ? updated : item));
                    await refresh();
                  })}>{busy === `schedule:${schedule.id}` ? '正在提交' : schedule.lastOutcome === 'failed' || schedule.lastOutcome === 'interrupted' ? '确认手动重试' : '确认运行一次'}</Button></div></div> : null}
                </div>
                <button
                  type="button"
                  title={schedule.lastOutcome === 'failed' || schedule.lastOutcome === 'interrupted' ? '手动重试，先确认费用' : '运行一次，先确认费用'}
                  aria-label={`手动运行${schedule.name}`}
                  disabled={Boolean(busy) || Boolean(schedule.activeExecution || schedule.pendingRun) || !Number.isSafeInteger(schedule.intervalMs) || schedule.intervalMs < 60_000}
                  className="rounded-full p-2 text-ink-muted hover:bg-paper-inset hover:text-ink"
                  onClick={() => setConfirmRun((current) => current === schedule.id ? '' : schedule.id)}
                >
                  <Play size={14} />
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy) || !schedule.enabled && (!Number.isSafeInteger(schedule.intervalMs) || schedule.intervalMs < 60_000)}
                  onClick={() => void perform(`schedule:${schedule.id}`, async () => {
                    const updated = await api.updateSchedule(schedule.id, { enabled: schedule.pendingRun ? false : !schedule.enabled });
                    if (!mounted.current) return;
                    ++readSequence.current; setSchedules((current) => current.map((item) => item.id === updated.id ? updated : item));
                    await refresh();
                  })}
                  className={cn(
                    'rounded-full px-3 py-1 text-[11px]',
                    schedule.enabled ? 'bg-success-bg text-success' : 'bg-paper-inset text-ink-muted',
                  )}
                >
                  {schedule.pendingRun && !schedule.enabled ? '取消待执行' : schedule.enabled ? '暂停后续执行' : '启用'}
                </button>
                <button
                  type="button"
                  className="rounded-full p-2 text-ink-muted hover:text-danger"
                  disabled={Boolean(busy) || Boolean(schedule.activeExecution)}
                  aria-label={`删除${schedule.name}`}
                  onClick={() => void perform(`schedule:${schedule.id}`, async () => {
                    await api.deleteSchedule(schedule.id);
                    if (!mounted.current) return;
                    ++readSequence.current; setSchedules((current) => current.filter((item) => item.id !== schedule.id));
                    await refresh();
                  })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
