import type { ToolCallPart } from '../../../shared/chat';
import type { FileDiffPreview } from '../../../shared/stream';

/** Pull the before/after file snapshot a write tool attaches to its result. */
export function toolDiffPreview(part: ToolCallPart): FileDiffPreview | null {
  if (!part.result) return null;
  try {
    const parsed = JSON.parse(part.result) as { preview?: Partial<FileDiffPreview> };
    const p = parsed.preview;
    if (
      p &&
      typeof p.path === 'string' &&
      typeof p.before === 'string' &&
      typeof p.after === 'string'
    ) {
      return p as FileDiffPreview;
    }
  } catch {
    /* raw result — no preview */
  }
  return null;
}

export function toolLabel(name: string): string {
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

export function toolAction(name: string): 'read' | 'edit' | 'write' | 'run' | 'search' {
  if (name === 'run_command') return 'run';
  if (name === 'edit_file') return 'edit';
  if (name === 'write_file') return 'write';
  if (name === 'grep' || name === 'find_files') return 'search';
  return 'read';
}

export function toolTarget(part: ToolCallPart): string {
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

export function toolDetail(part: ToolCallPart): string {
  let diff = '';
  if (part.result) {
    try {
      const parsed = JSON.parse(part.result) as { diff?: string };
      if (typeof parsed.diff === 'string') diff = parsed.diff;
    } catch {
      /* raw */
    }
  }
  const running = part.result === undefined && part.error === undefined;
  const body = diff || part.error || part.result || '';
  if (body) return body.slice(0, 4000);
  return running ? `输入:\n${formatArgs(part.args)}` : '';
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
