import { useState } from 'react';
import { Share2 } from 'lucide-react';
import type { Artifact } from '../../../shared/artifact';

const FRAMEWORK_PROMPTS: { id: string; label: string; line: string }[] = [
  { id: 'react', label: 'React 组件', line: '把它转换成一个自包含的 React 函数组件（TypeScript + Tailwind），保持视觉与结构一致。' },
  { id: 'vue', label: 'Vue 组件', line: '把它转换成一个 Vue 3 `<script setup>` 单文件组件，保持视觉与结构一致。' },
  { id: 'svelte', label: 'Svelte 组件', line: '把它转换成一个 Svelte 组件，保持视觉与结构一致。' },
  { id: 'refine', label: '继续打磨', line: '在此基础上继续打磨：收紧结构、修正格式、去掉冗余，不改变意图。' },
  { id: 'explain', label: '讲解 / 评审', line: '逐段讲解它的结构与取舍，指出可以改进的地方。' },
];

/** X4: hand an artifact off — copy a framework-targeted prompt for a CLI. */
export default function HandoffMenu({ artifact, getContent }: { artifact: Artifact; getContent: () => string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function copyFor(id: string, line: string) {
    const content = getContent();
    const fence = artifact.kind === 'markdown' ? 'markdown' : artifact.kind === 'html' ? 'html' : '';
    const prompt = content
      ? `这是我的作品《${artifact.name}》（${artifact.kind}）：\n\n\`\`\`${fence}\n${content}\n\`\`\`\n\n${line}`
      : `这是我的作品《${artifact.name}》（${artifact.kind}）。${line}`;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(id);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={['rounded p-1 hover:bg-paper-inset hover:text-ink', open ? 'text-accent' : 'text-ink-muted'].join(' ')}
        title="交给…"
      >
        <Share2 size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-20 w-40 rounded-lg border border-line bg-paper-raised py-1 shadow-lg">
          <div className="px-3 py-1 text-[10px] text-ink-muted">复制给 CLI / 对话</div>
          {FRAMEWORK_PROMPTS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => void copyFor(f.id, f.line)}
              className="block w-full px-3 py-1.5 text-left text-[11px] hover:bg-paper-inset"
            >
              {copied === f.id ? '已复制 ✓' : f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
