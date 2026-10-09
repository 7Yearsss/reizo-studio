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
    case 'open_canvas': return '打开画布';
    case 'create_storyboard_pipeline': return '编排分镜流水线';
    case 'attach_reference': return '挂载参考图';
    case 'group_nodes': return '成组节点';
    case 'add_node': return '画布加节点';
    case 'run_node': return '运行画布节点';
    case 'run_graph': return '运行画布';
    case 'read_canvas': return '读取画布';
    case 'read_node': return '读取画布节点';
    case 'update_node': return '修改画布节点';
    case 'connect_nodes': return '连接画布节点';
    case 'delete_node': return '删除画布节点';
    case 'generate_image': return '生成图片';
    case 'computer': return '操作电脑';
    case 'generate_diagram': return '生成流程图';
    case 'generate_sheet': return '生成表格';
    case 'read_sheet': return '读取表格';
    case 'read_document': return '读取文档';
    case 'generate_document': return '创建文档';
    case 'propose_document_edits': return '提出文档修改建议';
    case 'read_presentation': return '读取演示稿';
    case 'generate_presentation': return '创建演示稿';
    case 'propose_presentation_edits': return '提出 PPT 修改建议';
    case 'read_html': return '读取 HTML 页面';
    case 'generate_html': return '创建 HTML 页面';
    case 'propose_html_edits': return '提出 HTML 修改建议';
    case 'propose_sheet_edits': return '提出表格修改建议';
    default: return name.replace(/[_-]+/g, ' ');
  }
}

export function toolAction(name: string): 'read' | 'edit' | 'write' | 'run' | 'search' {
  if (name === 'run_command') return 'run';
  if (name === 'edit_file') return 'edit';
  if (name === 'write_file') return 'write';
  if (name === 'generate_sheet' || name === 'propose_sheet_edits') return 'edit';
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
  if (['read_document', 'generate_document', 'propose_document_edits', 'read_html', 'generate_html', 'propose_html_edits', 'read_presentation', 'generate_presentation', 'propose_presentation_edits'].includes(part.name) && part.result) {
    try {
      const result = JSON.parse(part.result);
      if (result.error) return String(result.error);
      if (result.summary) return String(result.summary);
      if (result.name) return `${part.name.startsWith('read_') ? '已读取' : '已创建'}「${result.name}」${result.version ? ` · v${result.version}` : ''}`;
      if (Array.isArray(result.presentations)) return result.presentations.map((deck: { name: string }) => deck.name).join('\n') || '当前会话没有演示稿';
      if (Array.isArray(result.pages)) return result.pages.map((page: { name: string }) => page.name).join('\n') || '当前会话没有 HTML 页面';
      if (Array.isArray(result.documents)) return result.documents.map((doc: { name: string }) => doc.name).join('\n') || '当前会话没有文档';
    } catch { /* Partial tool output. */ }
  }
  if ((part.name === 'read_sheet' || part.name === 'generate_sheet' || part.name === 'propose_sheet_edits') && part.result) {
    try {
      const result = JSON.parse(part.result);
      if (result.error) return String(result.error);
      if (Array.isArray(result.changes)) return `${result.changes.length} 项修改待审核\n${result.changes.join('\n')}`;
      if (result.name) return `${part.name === 'read_sheet' ? '已读取' : '已更新'}「${result.name}」${result.version ? ` · v${result.version}` : ''}`;
      if (Array.isArray(result.workbooks)) return result.workbooks.map((book: { name: string }) => book.name).join('\n') || '当前会话没有表格';
    } catch { /* streamed output is not complete yet */ }
  }
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
