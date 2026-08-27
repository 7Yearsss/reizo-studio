import { useState, type FormEvent } from 'react';
import { FolderKanban, LoaderCircle, X } from 'lucide-react';
import * as projectStore from '../../state/projectStore';
import * as uiStore from '../../state/uiStore';

export default function ProjectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setName('');
    setDescription('');
    setInstructions('');
    setError(null);
    setPending(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      const project = await projectStore.createProject({
        name: trimmed,
        description: description.trim() || undefined,
        instructions: instructions.trim() || undefined,
      });
      uiStore.selectProject(project.id);
      uiStore.setMode('projects');
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建项目失败');
      setPending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4" onClick={close}>
      <form
        onSubmit={(e) => void submit(e)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-paper-raised shadow-[0_28px_80px_-24px_rgba(28,22,18,0.4)]"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-paper-inset text-ink">
            <FolderKanban size={16} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">创建项目</h2>
            <p className="mt-0.5 text-xs leading-5 text-ink-muted">把相关对话、作品和工作规则放在同一个空间。</p>
          </div>
          <button type="button" onClick={close} className="rounded-md p-1 text-ink-muted hover:bg-paper-inset hover:text-ink" aria-label="关闭">
            <X size={14} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">项目名称</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
              placeholder="例如：品牌官网重构"
              className="h-10 w-full rounded-[10px] bg-paper px-3 text-sm text-ink outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">
              简介 <span className="font-normal opacity-70">可选</span>
            </span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={240}
              placeholder="一句话说明这个项目"
              className="h-10 w-full rounded-[10px] bg-paper px-3 text-sm text-ink outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">
              工作规则 <span className="font-normal opacity-70">可选</span>
            </span>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={4000}
              rows={4}
              placeholder="告诉 Agent 这个项目需要遵守的背景、语气或技术约束"
              className="w-full resize-y rounded-[10px] bg-paper px-3 py-2.5 text-sm leading-5 text-ink outline-none"
            />
          </label>
          {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={close} className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2 text-sm text-ink-muted">
            取消
          </button>
          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-[10px] bg-ink px-3.5 py-2 text-sm font-medium text-paper-raised disabled:opacity-50"
          >
            {pending ? <LoaderCircle size={14} className="animate-spin" /> : null}
            {pending ? '创建中' : '创建项目'}
          </button>
        </div>
      </form>
    </div>
  );
}
