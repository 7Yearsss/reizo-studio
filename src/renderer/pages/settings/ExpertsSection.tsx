import { useCallback, useEffect, useState } from 'react';
import { Bot, Plus, Trash2 } from 'lucide-react';
import * as api from '../../api';
import { toast } from '../../lib/toast';

interface Draft {
  name: string;
  aliases: string;
  description: string;
  instructions: string;
  model: string;
  allowedTools: string;
}

const EMPTY: Draft = { name: '', aliases: '', description: '', instructions: '', model: '', allowedTools: '' };

const fromExpert = (e: api.ExpertItem): Draft => ({
  name: e.name, aliases: e.aliases.join(', '), description: e.description, instructions: e.instructions, model: e.model ?? '', allowedTools: e.allowedTools ?? '',
});

const field = 'w-full rounded-xl bg-paper-inset px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function ExpertsSection() {
  const [experts, setExperts] = useState<api.ExpertItem[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => { void api.listExperts().then(setExperts, () => setExperts([])); }, []);
  useEffect(load, [load]);

  async function save() {
    if (!editing || saving) return;
    const { draft } = editing;
    setSaving(true);
    try {
      const saved = await api.saveExpert({
        name: draft.name.trim(),
        aliases: draft.aliases.split(/[,，]/).map((a) => a.trim()).filter(Boolean),
        description: draft.description,
        instructions: draft.instructions,
        model: draft.model.trim() || undefined,
        allowedTools: draft.allowedTools.trim() || undefined,
      });
      // Renaming creates a new expert (the name is the handle), so drop the old one.
      if (editing.id && editing.id !== saved.id) await api.deleteExpert(editing.id);
      toast.success(`已保存，输入 @${saved.name} 即可使用`);
      setEditing(null);
      load();
    } catch (error) {
      toast.error('保存失败', error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  const set = (patch: Partial<Draft>) => setEditing((current) => current && { ...current, draft: { ...current.draft, ...patch } });

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">专家</h1>
      <p className="mb-5 text-sm text-ink-muted">保存一位擅长某件事的专家。在输入框开头写 @名字，这条消息就交给 TA，回答仍在当前对话里。</p>

      {editing ? (
        <div className="space-y-3 rounded-2xl border border-line bg-paper-raised p-4">
          <input aria-label="名字" value={editing.draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={40} placeholder="名字，例如：文案专家（不含空格）" className={field} />
          <input aria-label="别名" value={editing.draft.aliases} onChange={(e) => set({ aliases: e.target.value })} placeholder="别名，逗号分隔，例如：copywriter, 写手" className={field} />
          <input aria-label="简介" value={editing.draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="一句话简介（出现在 @ 菜单里）" className={field} />
          <textarea aria-label="职责与做事方式" value={editing.draft.instructions} onChange={(e) => set({ instructions: e.target.value })} rows={7} maxLength={8000} placeholder="TA 是谁、怎么做事、产出什么格式。例如：你是资深电商文案，先问清受众和卖点，再给三个版本……" className={field} />
          <div className="grid gap-3 sm:grid-cols-2">
            <input aria-label="模型" value={editing.draft.model} onChange={(e) => set({ model: e.target.value })} placeholder="独立模型（可选，留空用当前模型）" className={field} />
            <input aria-label="可用工具" value={editing.draft.allowedTools} onChange={(e) => set({ allowedTools: e.target.value })} placeholder="可用工具（可选）如 read_file, grep" className={field} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className="rounded-full px-4 py-1.5 text-sm text-ink-muted hover:text-ink">取消</button>
            <button type="button" onClick={() => void save()} disabled={saving || !editing.draft.name.trim() || !editing.draft.instructions.trim()} className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper-raised disabled:opacity-40">
              保存
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing({ id: null, draft: EMPTY })} className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-1.5 text-sm text-paper-raised">
          <Plus size={14} /> 新建专家
        </button>
      )}

      {experts && experts.length === 0 && !editing ? <p className="text-sm text-ink-muted">还没有专家。</p> : null}
      <ul className="mt-4 space-y-2">
        {(experts ?? []).map((expert) => (
          <li key={expert.id} className="flex items-center gap-3 rounded-xl border border-line bg-paper-raised px-3 py-2">
            <Bot size={16} className="shrink-0 text-accent" />
            <button type="button" onClick={() => setEditing({ id: expert.id, draft: fromExpert(expert) })} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm text-ink">@{expert.name}{expert.model ? <span className="ml-2 text-xs text-ink-muted">{expert.model}</span> : null}</span>
              <span className="block truncate text-xs text-ink-muted">{expert.description || expert.instructions}</span>
            </button>
            <button
              type="button"
              aria-label={`删除 ${expert.name}`}
              onClick={() => void api.deleteExpert(expert.id).then(() => { toast.success('已删除'); load(); }, () => toast.error('删除失败'))}
              className="rounded p-1 text-ink-muted hover:text-danger"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
