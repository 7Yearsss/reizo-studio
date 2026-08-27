import { useEffect, useState } from 'react';
import { Play, Plus, Trash2 } from 'lucide-react';
import type { Schedule, Thought } from '../../shared/schedule';
import { SCHEDULE_PRESETS } from '../../shared/schedule';
import * as api from '../api';
import * as chatStore from '../state/chatStore';
import * as tabStore from '../state/tabStore';
import { useSkillStore } from '../state/useSkillStore';
import { cn } from '../lib/cn';

export default function AutomationPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [prompt, setPrompt] = useState('');
  const [thoughtDraft, setThoughtDraft] = useState('');
  const [intervalMs, setIntervalMs] = useState(SCHEDULE_PRESETS[2].intervalMs);
  const skills = useSkillStore().skills;
  const [skillId, setSkillId] = useState('');

  async function refresh() {
    const [scheduleData, thoughtData] = await Promise.all([api.listSchedules(), api.listThoughts()]);
    setSchedules(scheduleData.schedules);
    setThoughts(thoughtData);
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="flex h-full min-w-0">
      <section className="flex w-[320px] shrink-0 flex-col border-r border-line bg-sidebar">
        <header className="px-4 py-4">
          <h1 className="text-lg font-semibold">想法</h1>
          <p className="mt-1 text-xs text-ink-muted">先记下来，再派给 Agent。</p>
        </header>
        <div className="px-3 pb-3">
          <textarea
            value={thoughtDraft}
            onChange={(e) => setThoughtDraft(e.target.value)}
            placeholder="记一条想法…"
            rows={3}
            className="w-full resize-none rounded-2xl bg-paper px-3 py-2 text-sm text-ink outline-none"
          />
          <button
            type="button"
            className="mt-2 text-xs text-accent"
            onClick={async () => {
              if (!thoughtDraft.trim()) return;
              await api.createThought(thoughtDraft.trim());
              setThoughtDraft('');
              await refresh();
            }}
          >
            保存想法
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-4">
          {thoughts.map((thought) => (
            <div key={thought.id} className="rounded-2xl border border-line bg-paper-raised p-3">
              <p className="text-sm text-ink">{thought.content}</p>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  className="text-[11px] text-accent"
                  onClick={async () => {
                    const session = await chatStore.createSession(thought.content.slice(0, 40));
                    tabStore.openChatTab(session.id, session.title);
                    void chatStore.sendMessage(session.id, thought.content);
                  }}
                >
                  讨论
                </button>
                <button
                  type="button"
                  className="text-[11px] text-danger"
                  onClick={async () => {
                    await api.deleteThought(thought.id);
                    await refresh();
                  }}
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
            <p className="mt-1 text-xs text-ink-muted">按间隔在本机自动跑一轮对话。</p>
          </div>
        </header>
        <div className="border-b border-line px-6 pb-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="到期后让 Agent 做什么…"
            rows={2}
            className="w-full resize-none rounded-2xl bg-sidebar px-3 py-2 text-sm text-ink outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              className="rounded-full bg-sidebar px-3 py-1.5 text-xs text-ink outline-none"
            >
              {SCHEDULE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.intervalMs}>
                  {preset.label}
                </option>
              ))}
            </select>
            <select
              value={skillId}
              onChange={(e) => setSkillId(e.target.value)}
              className="rounded-full bg-sidebar px-3 py-1.5 text-xs text-ink outline-none"
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
              onClick={async () => {
                if (!prompt.trim()) return;
                await api.createSchedule({ prompt: prompt.trim(), intervalMs, skillId: skillId || undefined });
                setPrompt('');
                await refresh();
              }}
            >
              <Plus size={12} />
              新建自动化
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto px-6 py-4">
          {schedules.length === 0 && <p className="text-sm text-ink-muted">还没有定时任务。</p>}
          {schedules.map((schedule) => (
            <div key={schedule.id} className="rounded-2xl border border-line bg-paper-raised p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{schedule.name}</p>
                  <p className="mt-1 text-sm text-ink-muted">{schedule.prompt}</p>
                  <p className="mt-2 text-[11px] text-ink-muted">
                    {schedule.enabled ? '运行中' : '已暂停'} · 下次 {new Date(schedule.nextRunAt).toLocaleString()} · 已跑 {schedule.runCount} 次
                    {schedule.lastError ? ` · 上次失败：${schedule.lastError}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  title="立即运行一次（把下次时间提前到现在）"
                  className="rounded-full p-2 text-ink-muted hover:bg-paper-inset hover:text-ink"
                  onClick={async () => {
                    await api.updateSchedule(schedule.id, {
                      enabled: true,
                      nextRunAt: new Date().toISOString(),
                    });
                    await refresh();
                  }}
                >
                  <Play size={14} />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await api.updateSchedule(schedule.id, { enabled: !schedule.enabled });
                    await refresh();
                  }}
                  className={cn(
                    'rounded-full px-3 py-1 text-[11px]',
                    schedule.enabled ? 'bg-success-bg text-success' : 'bg-paper-inset text-ink-muted',
                  )}
                >
                  {schedule.enabled ? '暂停' : '启用'}
                </button>
                <button
                  type="button"
                  className="rounded-full p-2 text-ink-muted hover:text-danger"
                  onClick={async () => {
                    await api.deleteSchedule(schedule.id);
                    await refresh();
                  }}
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
