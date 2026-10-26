import { useCallback, useEffect, useState } from 'react';
import { Lock, Trash2 } from 'lucide-react';
import * as api from '../../api';
import { cn } from '../../lib/cn';
import { toast } from '../../lib/toast';
import { memoryAgeDays, STALE_MEMORY_DAYS } from '../../../shared/memoryAge';

type Scope = 'personal' | 'workspace';

const TYPE_LABEL: Record<string, string> = { user: '偏好', feedback: '反馈', project: '项目', reference: '参考', lesson: '经验' };
const TYPE_TONE: Record<string, string> = {
  user: 'bg-[color-mix(in_srgb,#3b82f6_14%,transparent)] text-[#2563eb]',
  feedback: 'bg-[color-mix(in_srgb,#d9622b_14%,transparent)] text-[#d9622b]',
  project: 'bg-[color-mix(in_srgb,#10b981_14%,transparent)] text-[#059669]',
  reference: 'bg-paper-inset text-ink-muted',
  lesson: 'bg-paper-inset text-ink-muted',
};

function EntryRow({ entry, scope, onChanged }: { entry: api.MemoryItem; scope: Scope; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(entry.body);
  const [isPrivate, setIsPrivate] = useState(entry.private === true);
  const days = memoryAgeDays(entry.updatedAt);
  const stale = days !== null && days > STALE_MEMORY_DAYS;
  const dirty = text !== entry.body || isPrivate !== (entry.private === true);

  return (
    <li className="rounded-xl border border-line bg-paper-raised">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px]', TYPE_TONE[entry.type] ?? TYPE_TONE.reference)}>{TYPE_LABEL[entry.type] ?? entry.type}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{entry.name}</span>
          <span className="block truncate text-xs text-ink-muted">{entry.description}</span>
        </span>
        {entry.private ? <Lock size={13} className="shrink-0 text-ink-muted" aria-label="私密" /> : null}
        {days !== null ? <span className={cn('shrink-0 text-[11px]', stale ? 'text-danger' : 'text-ink-muted')}>{stale ? `${days} 天未更新` : days === 0 ? '今天' : `${days} 天前`}</span> : null}
      </button>
      {open ? (
        <div className="space-y-2 border-t border-line px-3 py-3">
          <textarea
            aria-label="记忆内容"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            className="w-full resize-y rounded-xl bg-paper-inset px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex items-center gap-3 text-xs text-ink-muted">
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
              私密（不自动带入对话，只在需要时读取）
            </label>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => void api.deleteMemory(entry.fileName, scope).then(() => { toast.success('已删除'); onChanged(); }, () => toast.error('删除失败'))}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 hover:text-danger"
            >
              <Trash2 size={12} /> 删除
            </button>
            <button
              type="button"
              disabled={!dirty || !text.trim()}
              onClick={() => void api.saveMemory(entry.fileName, scope, { body: text, private: isPrivate }).then(() => { toast.success('已保存'); onChanged(); }, (e: unknown) => toast.error('保存失败', e instanceof Error ? e.message : undefined))}
              className="rounded-full bg-ink px-3 py-1 text-paper-raised disabled:opacity-40"
            >
              保存
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default function MemorySection() {
  const [scope, setScope] = useState<Scope>('personal');
  const [data, setData] = useState<{ available: boolean; entries: api.MemoryItem[] } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(() => {
    void api.listMemory(scope).then(setData, () => setData({ available: false, entries: [] }));
  }, [scope]);
  useEffect(() => { setData(null); setConfirmClear(false); load(); }, [load]);

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">记忆</h1>
      <p className="mb-5 text-sm text-ink-muted">Agent 记住的偏好和事实。个人记忆跟着你走，工作区记忆属于当前文件夹。</p>

      <div className="mb-4 flex items-center gap-2">
        {([['personal', '个人'], ['workspace', '当前工作区']] as [Scope, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setScope(id)}
            aria-pressed={scope === id}
            className={cn('rounded-full px-4 py-1.5 text-sm transition-colors', scope === id ? 'bg-ink font-medium text-paper-raised' : 'text-ink hover:bg-paper-inset/80')}
          >
            {label}
          </button>
        ))}
        <span className="flex-1" />
        {data && data.entries.length > 0 ? (
          confirmClear ? (
            <button type="button" onClick={() => void api.clearMemory(scope).then(() => { toast.success('已清空'); setConfirmClear(false); load(); }, () => toast.error('清空失败'))} className="rounded-full bg-danger px-3 py-1 text-xs text-white">
              再点一次确认清空
            </button>
          ) : (
            <button type="button" onClick={() => setConfirmClear(true)} className="rounded-full px-3 py-1 text-xs text-ink-muted hover:text-danger">清空</button>
          )
        ) : null}
      </div>

      {data === null ? null : !data.available ? (
        <p className="text-sm text-ink-muted">还没有选择工作区。</p>
      ) : data.entries.length === 0 ? (
        <p className="text-sm text-ink-muted">还没有记忆。聊天中说「记住……」，Agent 就会存在这里。</p>
      ) : (
        <ul className="space-y-2">
          {data.entries.map((entry) => <EntryRow key={`${scope}:${entry.fileName}`} entry={entry} scope={scope} onChanged={load} />)}
        </ul>
      )}
    </div>
  );
}
