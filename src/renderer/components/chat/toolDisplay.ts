import type { ToolCallPart } from '../../../shared/chat';
import type { FileDiffPreview } from '../../../shared/stream';

export type SniffedAction =
  | 'search'
  | 'read'
  | 'write'
  | 'edit'
  | 'delete'
  | 'git'
  | 'test'
  | 'build'
  | 'install'
  | 'run';

export interface SniffedCommand {
  action: SniffedAction;
  label: string;
  target: string;
  unwrapped: string;
}

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

/**
 * Strips shell wrappers (PowerShell, POSIX bash/zsh, cmd.exe) up to 2 passes.
 * e.g. powershell -Command "Get-ChildItem ..." => Get-ChildItem ...
 */
export function unwrapCommand(command: string): string {
  let c = String(command ?? '').trim();
  for (let i = 0; i < 2; i++) {
    // PowerShell / pwsh: powershell -Command "..." or pwsh -c "..."
    const ps = c.match(
      /^(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\s+(?:-[a-zA-Z]+\s+)*(?:(?:-Command|-c)\s+)?(['"])([\s\S]*)\1$/i,
    );
    if (ps) {
      c = ps[2].trim();
      continue;
    }
    // Bash / Zsh / Sh: /bin/bash -c "..." or zsh -lc '...'
    const sh = c.match(
      /^(?:\/bin\/|\/usr\/bin\/)?(?:sh|bash|zsh|dash)(?:\.exe)?\s+(?:-[a-zA-Z]+\s+)*(['"])([\s\S]*)\1$/i,
    );
    if (sh) {
      c = sh[2].trim();
      continue;
    }
    // Cmd: cmd /c "..."
    const cmd = c.match(/^cmd(?:\.exe)?\s+\/c\s+(['"]?)([\s\S]*)\1$/i);
    if (cmd) {
      c = cmd[2].trim();
      continue;
    }
    break;
  }
  return c;
}

function cleanPath(raw: string): string {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/[\\/]+/g, '/');
}

function extractParam(cmd: string, flag: string): string | null {
  const re = new RegExp(`(?:${flag})\\s+(['"]?)([^'"\\s|;&]+)\\1`, 'i');
  const m = cmd.match(re);
  return m ? m[2] : null;
}

/**
 * Intelligently sniffs what a shell command is actually doing (Searching, Reading,
 * Testing, Git ops, Building, Editing) to display human-first semantics.
 * Ported and enhanced from Open Design's chat runtime architecture.
 */
export function sniffCommandIntent(rawCommand: string): SniffedCommand {
  const unwrapped = unwrapCommand(rawCommand);
  const cmd = unwrapped.trim();

  // 1. Git commands
  const gitMatch = cmd.match(/^git\s+([a-zA-Z_-]+)(?:\s+([\s\S]*))?$/);
  if (gitMatch) {
    const sub = gitMatch[1].toLowerCase();
    const rest = (gitMatch[2] || '').trim();

    if (sub === 'status') {
      return { action: 'git', label: 'Git 状态', target: '检查工作区文件改动', unwrapped };
    }
    if (sub === 'diff') {
      const target = rest ? `对比差异 (${cleanPath(rest)})` : '对比代码改动';
      return { action: 'git', label: 'Git 对比', target, unwrapped };
    }
    if (sub === 'log') {
      return { action: 'git', label: 'Git 历史', target: '查看提交记录', unwrapped };
    }
    if (sub === 'add') {
      const target = rest ? `暂存 ${cleanPath(rest)}` : '暂存文件变更';
      return { action: 'git', label: 'Git 暂存', target, unwrapped };
    }
    if (sub === 'commit') {
      const msgMatch = rest.match(/-m\s*(['"])([\s\S]*?)\1/);
      const target = msgMatch ? `“${msgMatch[2]}”` : '提交代码变更';
      return { action: 'git', label: 'Git 提交', target, unwrapped };
    }
    if (sub === 'checkout' || sub === 'switch') {
      return { action: 'git', label: 'Git 分支', target: `切换到 ${cleanPath(rest)}`, unwrapped };
    }
    if (sub === 'branch') {
      return { action: 'git', label: 'Git 分支', target: rest || '查看分支列表', unwrapped };
    }
    if (sub === 'push') {
      return { action: 'git', label: 'Git 推送', target: rest ? `推送 ${rest}` : '推送代码到远程', unwrapped };
    }
    if (sub === 'pull' || sub === 'fetch') {
      return { action: 'git', label: 'Git 拉取', target: rest ? `拉取远程更新 (${rest})` : '拉取远程更新', unwrapped };
    }
    return { action: 'git', label: 'Git 操作', target: `git ${sub} ${rest}`.trim(), unwrapped };
  }

  // 2. Unit Testing & E2E
  if (/^(?:npx\s+)?(?:vitest|jest|mocha|pytest)\b|npm\s+(?:run\s+)?test\b|pnpm\s+test\b/i.test(cmd)) {
    const fileMatch = cmd.match(/([a-zA-Z0-9_\-./\\]+\.test\.[a-zA-Z0-9]+)/i);
    const target = fileMatch ? `运行 ${cleanPath(fileMatch[1]).split('/').pop()}` : '运行自动化测试套件';
    return { action: 'test', label: '单元测试', target, unwrapped };
  }

  // 3. Build & Type Checking & Lint
  if (/^(?:npx\s+)?tsc\b|typecheck/i.test(cmd)) {
    return { action: 'build', label: '类型检查', target: 'TypeScript 类型核验', unwrapped };
  }
  if (/^(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:build|package|make)\b|^vite\s+build\b/i.test(cmd)) {
    return { action: 'build', label: '项目构建', target: '编译与打包产物', unwrapped };
  }
  if (/^(?:npm|pnpm|yarn)\s+(?:run\s+)?lint\b|eslint\b/i.test(cmd)) {
    return { action: 'build', label: '代码检查', target: 'ESLint 代码规范扫描', unwrapped };
  }

  // 4. Package Installation
  const pkgMatch = cmd.match(/^(?:npm\s+(?:i|install)|pnpm\s+(?:add|i|install)|yarn\s+add|pip\s+install)\s+([^&|;]+)/i);
  if (pkgMatch) {
    const pkgs = pkgMatch[1].replace(/--[a-zA-Z-]+/g, '').trim();
    return { action: 'install', label: '依赖安装', target: pkgs ? `安装 ${pkgs}` : '安装依赖包', unwrapped };
  }

  // 5. Code Search & grep
  // PowerShell: Select-String
  if (/^Select-String\b/i.test(cmd)) {
    const pattern = extractParam(cmd, '-Pattern') || '';
    const path = extractParam(cmd, '-Path') || '';
    const target = pattern
      ? `检索 "${pattern}"${path ? ` (${cleanPath(path)})` : ''}`
      : path ? `搜索 ${cleanPath(path)}` : '搜索代码内容';
    return { action: 'search', label: '搜索代码', target, unwrapped };
  }
  // POSIX: grep / rg / ag
  const grepMatch = cmd.match(/^(?:grep|rg|ag)\s+(?:-[a-zA-Z0-9]+\s+)*(['"]?)(.*?)\1(?:\s+([a-zA-Z0-9_\-./\\]+))?$/i);
  if (grepMatch) {
    const pattern = grepMatch[2]?.trim() || '';
    const path = grepMatch[3] ? cleanPath(grepMatch[3]) : '';
    const target = pattern
      ? `检索 "${pattern}"${path ? ` (${path})` : ''}`
      : '搜索代码内容';
    return { action: 'search', label: '搜索代码', target, unwrapped };
  }

  // 6. File & Directory Search
  // PowerShell: Get-ChildItem
  if (/^Get-ChildItem\b/i.test(cmd)) {
    const filter = extractParam(cmd, '-Filter');
    const path = extractParam(cmd, '-Path') || '';
    const target = filter
      ? `查找 "${filter}"${path ? ` (${cleanPath(path)})` : ''}`
      : path ? `浏览目录 ${cleanPath(path)}` : '浏览文件目录';
    return { action: 'search', label: '查找文件', target, unwrapped };
  }
  // POSIX: find / fd
  if (/^(?:find|fd)\b/i.test(cmd)) {
    const nameMatch = cmd.match(/-name\s+(['"]?)([^'"\s]+)\1/i) || cmd.match(/-e\s+([a-zA-Z0-9]+)/i);
    const target = nameMatch ? `查找 "${nameMatch[2] || nameMatch[1]}"` : '查找文件';
    return { action: 'search', label: '查找文件', target, unwrapped };
  }
  // ls / dir
  if (/^(?:ls|dir|tree)\b/i.test(cmd)) {
    const parts = cmd.split(/\s+/).filter((p) => p && !p.startsWith('-'));
    const dir = parts[1] ? cleanPath(parts[1]) : '工作区目录';
    return { action: 'search', label: '列出目录', target: dir, unwrapped };
  }

  // 7. File Content Read
  // PowerShell: Get-Content
  if (/^Get-Content\b/i.test(cmd)) {
    const path = extractParam(cmd, '-Path') || cmd.split(/\s+/)[1];
    return { action: 'read', label: '读取文件', target: cleanPath(path || ''), unwrapped };
  }
  // POSIX: cat / head / tail / less / jq
  if (/^(?:cat|head|tail|less|more|jq)\b/i.test(cmd)) {
    const parts = cmd.split(/\s+/).filter((p) => p && !p.startsWith('-'));
    const file = parts[1] ? cleanPath(parts[1]) : '';
    return { action: 'read', label: '读取文件', target: file || '文件内容', unwrapped };
  }

  // 8. File Operations (Write, Edit, Delete)
  if (/^(?:mkdir|New-Item\s+.*-ItemType\s+Directory)\b/i.test(cmd)) {
    const path = extractParam(cmd, '-Path') || cmd.split(/\s+/).pop();
    return { action: 'write', label: '创建目录', target: cleanPath(path || ''), unwrapped };
  }
  if (/^(?:touch|New-Item)\b/i.test(cmd)) {
    const path = extractParam(cmd, '-Path') || cmd.split(/\s+/).pop();
    return { action: 'write', label: '创建文件', target: cleanPath(path || ''), unwrapped };
  }
  if (/^(?:rm|rmdir|del|Remove-Item)\b/i.test(cmd)) {
    const path = extractParam(cmd, '-Path') || cmd.split(/\s+/).pop();
    return { action: 'delete', label: '删除文件', target: cleanPath(path || ''), unwrapped };
  }
  if (/^(?:mv|Move-Item|Rename-Item)\b/i.test(cmd)) {
    return { action: 'edit', label: '移动/重命名', target: '文件整理', unwrapped };
  }
  if (/^(?:cp|Copy-Item)\b/i.test(cmd)) {
    return { action: 'write', label: '复制文件', target: '文件拷贝', unwrapped };
  }

  // 9. Script Execution
  if (/^(?:node|python|python3|tsx)\b/i.test(cmd)) {
    const parts = cmd.split(/\s+/);
    const script = parts[1] ? cleanPath(parts[1]).split('/').pop() : '执行脚本';
    return { action: 'run', label: '执行脚本', target: script || '运行脚本', unwrapped };
  }

  // Fallback
  const shortCmd = unwrapped.length > 60 ? `${unwrapped.slice(0, 58)}…` : unwrapped;
  return { action: 'run', label: '运行命令', target: `$ ${shortCmd}`, unwrapped };
}

export function toolLabel(name: string, part?: ToolCallPart): string {
  if (name === 'run_command' && part?.args) {
    const command =
      typeof part.args.command === 'string'
        ? part.args.command
        : typeof part.args.CommandLine === 'string'
          ? part.args.CommandLine
          : '';
    if (command) {
      return sniffCommandIntent(command).label;
    }
  }
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
    case 'check_sheet': return '检查表格';
    case 'read_document': return '读取文档';
    case 'check_document': return '检查文档一致性';
    case 'generate_document': return '创建文档';
    case 'propose_document_edits': return '提出文档修改建议';
    case 'read_presentation': return '读取演示稿';
    case 'generate_presentation': return '创建演示稿';
    case 'propose_presentation_edits': return '提出 PPT 修改建议';
    case 'propose_sheet_edits': return '提出表格修改建议';
    default: return name.replace(/[_-]+/g, ' ');
  }
}

export function toolAction(name: string, part?: ToolCallPart): string {
  if (name === 'run_command' && part?.args) {
    const command =
      typeof part.args.command === 'string'
        ? part.args.command
        : typeof part.args.CommandLine === 'string'
          ? part.args.CommandLine
          : '';
    if (command) {
      return sniffCommandIntent(command).action;
    }
    return 'run';
  }
  if (name === 'edit_file') return 'edit';
  if (name === 'write_file') return 'write';
  if (name === 'generate_sheet' || name === 'propose_sheet_edits') return 'edit';
  if (name === 'grep' || name === 'find_files') return 'search';
  return 'read';
}

export function toolTarget(part: ToolCallPart): string {
  const args = part.args;
  const command =
    typeof args.command === 'string'
      ? args.command
      : typeof args.CommandLine === 'string'
        ? args.CommandLine
        : '';
  if (part.name === 'run_command' && command) {
    return sniffCommandIntent(command).target;
  }
  const path = typeof args.path === 'string' ? args.path : '';
  const query = typeof args.query === 'string' ? args.query : '';
  const pattern = typeof args.pattern === 'string' ? args.pattern : '';
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
  if (['read_document', 'generate_document', 'propose_document_edits', 'read_presentation', 'generate_presentation', 'propose_presentation_edits'].includes(part.name) && part.result) {
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
  if ((part.name === 'read_sheet' || part.name === 'generate_sheet' || part.name === 'propose_sheet_edits' || part.name === 'check_sheet') && part.result) {
    try {
      const result = JSON.parse(part.result);
      if (result.error) return String(result.error);
      if (part.name === 'check_sheet' && typeof result.total === 'number') return result.total ? `发现 ${result.total} 处问题\n${(result.findings as Array<{ sheet: string; range: string; message: string }>).slice(0, 12).map((f) => `${f.sheet}!${f.range} ${f.message}`).join('\n')}` : '没有发现问题';
      if (Array.isArray(result.changes)) return `${result.changes.length} 项修改待审核\n${result.changes.join('\n')}${Array.isArray(result.warnings) && result.warnings.length ? `\n注意：${result.warnings.join('；')}` : ''}`;
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
