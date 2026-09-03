import { useEffect, useRef, useState } from 'react';
import { Columns2, Eye, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ArtifactRenderProps } from './types';

type Mode = 'preview' | 'split' | 'editor';
const AUTOSAVE_MS = 900;

export default function MarkdownRenderer({ text, onCommitDraft }: ArtifactRenderProps) {
  const editable = Boolean(onCommitDraft);
  const [mode, setMode] = useState<Mode>('preview');
  const [draft, setDraft] = useState(text);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const savedAtRef = useRef<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseRef = useRef(text);

  // Reset when the underlying content changes (version switch, external edit).
  useEffect(() => {
    setDraft(text);
    baseRef.current = text;
    setSaveState('idle');
  }, [text]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onChange(next: string) {
    setDraft(next);
    if (!onCommitDraft) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (next === baseRef.current) return;
      setSaveState('saving');
      void onCommitDraft(next).then(
        () => {
          baseRef.current = next;
          savedAtRef.current = new Date().toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          });
          setSaveState('saved');
        },
        () => setSaveState('idle'),
      );
    }, AUTOSAVE_MS);
  }

  const preview = (
    <div className="markdown min-w-0 flex-1 overflow-auto px-3 py-2 text-xs">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{mode === 'preview' ? text : draft}</ReactMarkdown>
    </div>
  );
  const editor = (
    <textarea
      value={draft}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      placeholder="在此输入文档内容、需求或给 Agent 的说明…"
      className="min-w-0 flex-1 resize-none bg-paper-raised px-3 py-2 font-mono text-[11px] leading-5 text-ink outline-none"
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {editable && (
        <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1">
          <ModeButton active={mode === 'preview'} onClick={() => setMode('preview')} icon={<Eye size={12} />} label="预览" />
          <ModeButton active={mode === 'split'} onClick={() => setMode('split')} icon={<Columns2 size={12} />} label="分屏" />
          <ModeButton active={mode === 'editor'} onClick={() => setMode('editor')} icon={<Pencil size={12} />} label="编辑" />
          <span className="ml-auto text-[10px] text-ink-muted">
            {saveState === 'saving' ? '保存中…' : saveState === 'saved' ? `已保存 · ${savedAtRef.current}` : ''}
          </span>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {mode === 'preview' && preview}
        {mode === 'editor' && editor}
        {mode === 'split' && (
          <>
            {editor}
            <div className="w-px shrink-0 bg-line" />
            {preview}
          </>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]',
        active ? 'bg-paper-inset text-ink' : 'text-ink-muted hover:bg-paper-inset/60',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  );
}
