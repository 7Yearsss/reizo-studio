import { useState } from 'react';
import { Check, ChevronRight, CircleAlert, LoaderCircle, Wrench } from 'lucide-react';
import type { ToolCallPart } from '../../../shared/chat';
import { cn } from '../../lib/cn';

export default function ToolCard({ part }: { part: ToolCallPart }) {
  const [open, setOpen] = useState(part.name === 'edit_file' || part.name === 'write_file');
  let diff = '';
  if (part.result) {
    try {
      const parsed = JSON.parse(part.result) as { diff?: string };
      if (typeof parsed.diff === 'string') diff = parsed.diff;
    } catch {
      /* raw */
    }
  }
  const body = diff || part.error || part.result || '';
  const running = part.result === undefined && part.error === undefined;
  const label = toolLabel(part.name);
  const target = toolTarget(part);
  const input = formatArgs(part.args);
  const detail = body || (running ? `输入:\n${input}` : '');

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-paper-raised">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink"
      >
        {running ? (
          <LoaderCircle size={13} className="shrink-0 animate-spin text-accent" />
        ) : part.error ? (
          <CircleAlert size={13} className="shrink-0 text-danger" />
        ) : (
          <Check size={13} className="shrink-0 text-success" />
        )}
        <Wrench size={13} className="shrink-0 text-ink-muted" />
        <span className="font-medium">{label}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-muted" title={target}>
          {target}
        </span>
        {part.error && <span className="text-danger">失败</span>}
        <ChevronRight size={13} className={cn('ml-auto shrink-0 text-ink-muted transition', open && 'rotate-90')} />
      </button>
      {open && detail && (
        <pre className="max-h-56 overflow-auto border-t border-line bg-paper px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
          {detail.slice(0, 4000)}
        </pre>
      )}
    </div>
  );
}

function toolLabel(name: string): string {
  switch (name) {
    case 'list_dir': return '读取目录';
    case 'read_file': return '读取文件';
    case 'find_files': return '查找文件';
    case 'grep': return '搜索内容';
    case 'edit_file': return '编辑文件';
    case 'write_file': return '写入文件';
    case 'run_command': return '运行命令';
    case 'todo_write': return '更新计划';
    case 'ask_user': return '等待你的回答';
    default: return name.replace(/[_-]+/g, ' ');
  }
}

function toolTarget(part: ToolCallPart): string {
  const args = part.args;
  const path = typeof args.path === 'string' ? args.path : '';
  const command = typeof args.command === 'string' ? args.command : '';
  const query = typeof args.query === 'string' ? args.query : '';
  const pattern = typeof args.pattern === 'string' ? args.pattern : '';
  if (part.name === 'run_command' && command) return `$ ${command}`;
  if (part.name === 'find_files') return query ? `find_files --query ${quote(query)}` : 'find_files';
  if (part.name === 'grep') {
    const scope = typeof args.path === 'string' && args.path ? ` --path ${quote(args.path)}` : '';
    return pattern ? `grep --pattern ${quote(pattern)}${scope}` : `grep${scope}`;
  }
  if (part.name === 'list_dir') return path ? `list_dir --path ${quote(path)}` : 'list_dir';
  if (part.name === 'read_file') return path ? `read_file --path ${quote(path)}` : 'read_file';
  if (part.name === 'edit_file' || part.name === 'write_file') {
    return path ? `${part.name} --path ${quote(path)}` : part.name;
  }
  if (path) return path;
  if (query) return `query: ${query}`;
  if (command) return `$ ${command}`;
  return '';
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function formatArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
