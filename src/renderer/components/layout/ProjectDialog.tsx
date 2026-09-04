import { useState, type FormEvent } from 'react';
import { FolderKanban, X } from 'lucide-react';
import * as projectStore from '../../state/projectStore';
import * as uiStore from '../../state/uiStore';
import { toast } from '../../lib/toast';
import { Input } from '../motion/input';
import { StatefulButton, type ButtonState } from '../motion/button/stateful';
import { CenterMorphModal, CenterMorphModalContent } from '../motion/center-morph-modal';

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
  const [btnState, setBtnState] = useState<ButtonState>('idle');

  function reset() {
    setName('');
    setDescription('');
    setInstructions('');
    setError(null);
    setBtnState('idle');
  }

  function close() {
    reset();
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || btnState === 'loading') return;
    setBtnState('loading');
    setError(null);
    try {
      const project = await projectStore.createProject({
        name: trimmed,
        description: description.trim() || undefined,
        instructions: instructions.trim() || undefined,
      });
      setBtnState('success');
      toast.success(`项目「${project.name}」已创建`);
      uiStore.selectProject(project.id);
      uiStore.setMode('projects');
      setTimeout(() => {
        close();
      }, 400);
    } catch (err) {
      setBtnState('error');
      setError(err instanceof Error ? err.message : '创建项目失败');
      toast.error('创建项目失败');
    }
  }

  return (
    <CenterMorphModal open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <CenterMorphModalContent
        ariaLabel="创建项目"
        showCloseButton={false}
        backdropClassName="bg-black/40 backdrop-blur-sm"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-paper-raised p-0 shadow-[0_28px_80px_-24px_rgba(28,22,18,0.4)]"
      >
        <form onSubmit={(e) => void submit(e)}>
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-paper-inset text-ink">
              <FolderKanban size={16} strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-ink">创建项目</h2>
              <p className="mt-0.5 text-xs leading-5 text-ink-muted">把相关对话、作品和工作规则放在同一个空间。</p>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-md p-1 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
              aria-label="关闭"
            >
              <X size={14} />
            </button>
          </div>

          <div className="space-y-4 px-5 py-5">
            <div>
              <span className="mb-1.5 block text-xs font-medium text-ink-muted">项目名称</span>
              <Input
                autoFocus
                value={name}
                onChange={(val) => {
                  setName(val);
                  if (error) setError(null);
                }}
                maxLength={80}
                required
                placeholder="例如：品牌官网重构"
                className="rounded-[10px] bg-paper"
              />
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-medium text-ink-muted">
                简介 <span className="font-normal opacity-70">可选</span>
              </span>
              <Input
                value={description}
                onChange={(val) => setDescription(val)}
                maxLength={240}
                placeholder="一句话说明这个项目"
                className="rounded-[10px] bg-paper"
              />
            </div>

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
                className="w-full resize-y rounded-[10px] border border-line/60 bg-paper px-3 py-2.5 text-sm leading-5 text-ink outline-none transition-colors focus:border-accent"
              />
            </label>

            {error ? (
              <p role="alert" className="text-xs text-danger font-medium">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={close}
              className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2 text-sm text-ink-muted hover:bg-paper-inset transition-colors"
            >
              取消
            </button>
            <StatefulButton
              type="submit"
              state={btnState}
              disabled={btnState === 'loading' || !name.trim()}
              loadingText="创建中"
              successText="已创建"
              errorText="重试"
              className="rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-paper-raised disabled:opacity-50"
            >
              创建项目
            </StatefulButton>
          </div>
        </form>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
