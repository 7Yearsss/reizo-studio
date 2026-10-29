import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, LoaderCircle, Pencil, Plus, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import type { HookEntry, McpServerEntry, McpTestResult, McpTransport, NodeEnvStatus } from '../../../shared/extensionConfig';
import { cn } from '../../lib/cn';
import { toast } from '../../lib/toast';
import * as uiStore from '../../state/uiStore';
import { Button } from '../../components/ui/button';
import {
  describeHook, describeMcpEntry, EMPTY_HOOK, EMPTY_MCP, formatKeyValueLines, maskSecrets, parseArgLines, parseKeyValueLines,
} from './extensionForm';
import { CatalogIcon } from '../../components/skills/CatalogIcon';
import { QuickIntegrationsBlock } from './QuickIntegrationsBlock';
import { confirmDialog } from '@/renderer/state/confirmStore';

const FIELD = 'w-full rounded-lg border border-line bg-paper-raised px-3 py-1.5 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent';
const LABEL = 'mb-1 block text-xs text-ink-muted';
const TRANSPORT_LABEL: Record<McpTransport, string> = { stdio: '本地程序', http: 'HTTP', sse: 'SSE' };

export function message(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error);
}

/** The editor shared by "add" and "edit": a draft that only reaches the file on save. */
export function McpForm({ initial, onSave, onCancel, hint }: { initial: McpServerEntry; onSave: (entry: McpServerEntry) => void; onCancel: () => void; hint?: React.ReactNode }) {
  const [name, setName] = useState(initial.name);
  const [transport, setTransport] = useState<McpTransport>(initial.transport);
  const [command, setCommand] = useState(initial.command ?? '');
  const [args, setArgs] = useState((initial.args ?? []).join('\n'));
  const [env, setEnv] = useState(formatKeyValueLines(initial.env, '='));
  const [url, setUrl] = useState(initial.url ?? '');
  const [headers, setHeaders] = useState(formatKeyValueLines(initial.headers, ':'));
  const [test, setTest] = useState<McpTestResult | 'running' | null>(null);
  const [nodeStatus, setNodeStatus] = useState<NodeEnvStatus | null>(null);

  useEffect(() => {
    window.reizo?.checkNodeEnvironment?.().then(setNodeStatus).catch(() => setNodeStatus({ available: false }));
  }, []);

  const draft = (): McpServerEntry => transport === 'stdio'
    ? { name: name.trim(), transport, command: command.trim(), args: parseArgLines(args), env: parseKeyValueLines(env, '='), ...(initial.cwd ? { cwd: initial.cwd } : {}), ...(initial.disabled ? { disabled: true } : {}) }
    : { name: name.trim(), transport, url: url.trim(), headers: parseKeyValueLines(headers, ':'), ...(initial.disabled ? { disabled: true } : {}) };

  const isNodeCommand = transport === 'stdio' && /^(npx|node)(\s|$)/.test(command.trim());
  const nodeMissing = isNodeCommand && nodeStatus !== null && !nodeStatus.available;

  async function runTest() {
    setTest('running');
    try { setTest(await window.reizo.testMcpServer(draft())); } catch (cause) { setTest({ ok: false, tools: [], messages: [message(cause)] }); }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-paper-raised p-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>名称（字母、数字、连字符）</label>
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 files" />
        </div>
        <div>
          <label className={LABEL}>连接方式</label>
          <div className="flex gap-1.5">
            {(Object.keys(TRANSPORT_LABEL) as McpTransport[]).map((t) => (
              <button key={t} type="button" onClick={() => setTransport(t)}
                className={cn('rounded-full px-3 py-1 text-xs transition-colors', transport === t ? 'bg-ink text-paper-raised' : 'border border-line text-ink-muted hover:border-ink-muted')}>
                {TRANSPORT_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {transport === 'stdio' ? (
        <>
          <div>
            <label className={LABEL}>启动命令</label>
            <input className={FIELD} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>参数（每行一个）</label>
              <textarea className={cn(FIELD, 'h-24 resize-y font-mono text-xs')} value={args} onChange={(e) => setArgs(e.target.value)} placeholder={'-y\n@modelcontextprotocol/server-filesystem\nC:\\项目'} />
            </div>
            <div>
              <label className={LABEL}>环境变量（每行 KEY=值）</label>
              <textarea className={cn(FIELD, 'h-24 resize-y font-mono text-xs')} value={env} onChange={(e) => setEnv(e.target.value)} placeholder="API_KEY=…" />
            </div>
          </div>
        </>
      ) : (
        <>
          <div>
            <label className={LABEL}>地址</label>
            <input className={FIELD} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
          </div>
          <div>
            <label className={LABEL}>请求头（每行 名称: 值）</label>
            <textarea className={cn(FIELD, 'h-20 resize-y font-mono text-xs')} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder="Authorization: Bearer …" />
          </div>
        </>
      )}
      {nodeMissing ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          ⚠️ 系统未检测到 Node.js。使用 npx/node 命令前请先安装 Node.js (https://nodejs.org)。
        </p>
      ) : null}
      {hint}
      {test === 'running' ? (
        <p className="flex items-center gap-2 text-xs text-ink-muted"><LoaderCircle size={13} className="animate-spin" />正在连接…</p>
      ) : test ? (
        <div className={cn('rounded-xl border px-3 py-2 text-xs', test.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5')}>
          <p className={cn('flex items-center gap-1.5 font-medium', test.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
            {test.ok ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />}
            {test.ok ? `连接成功，${test.tools.length} 个工具` : '需要注意'}
          </p>
          {test.messages.map((m) => <p key={m} className="mt-1 break-all text-ink-muted">{m}</p>)}
          {test.messages.some((m) => m.includes('withheld') || m.includes('mcp-baseline')) ? (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
              <span className="text-amber-700 dark:text-amber-300">检测到工具定义变更并已被拦截暂扣。</span>
              <Button
                size="xs"
                variant="outline"
                onClick={async () => {
                  try {
                    await window.reizo?.resetMcpBaseline?.(initial.name || name.trim());
                    toast.success(`已重置「${initial.name || name.trim()}」的信任基线`);
                    void runTest();
                  } catch (cause) {
                    toast.error('重置基线失败', message(cause));
                  }
                }}
              >
                重新信任此服务
              </Button>
            </div>
          ) : null}
          {test.tools.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5 text-ink-muted">
              {test.tools.map((t) => <li key={t.name} className="truncate"><span className="text-ink">{t.name}</span> {t.description}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void runTest()} disabled={test === 'running'}>测试连接</Button>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
          <Button size="sm" onClick={() => onSave(draft())}>保存</Button>
        </div>
      </div>
    </div>
  );
}

function McpBlock() {
  const [entries, setEntries] = useState<McpServerEntry[] | null>(null);
  const [editing, setEditing] = useState<{ index: number; entry: McpServerEntry } | null>(null);
  const [nodeStatus, setNodeStatus] = useState<NodeEnvStatus | null>(null);

  useEffect(() => {
    window.reizo?.checkNodeEnvironment?.().then(setNodeStatus).catch(() => setNodeStatus({ available: false }));
  }, []);

  const load = useCallback(async () => {
    try { setEntries((await window.reizo?.listMcpServers?.()) ?? []); } catch (cause) { toast.error('读取 MCP 配置失败', message(cause)); setEntries([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function persist(next: McpServerEntry[], done?: string) {
    try {
      if (window.reizo?.saveMcpServers) {
        await window.reizo.saveMcpServers(next);
      }
      setEntries(next);
      setEditing(null);
      if (done) toast.success(done);
    } catch (cause) { toast.error('保存失败', message(cause)); }
  }

  const list = entries ?? [];
  return (
    <section className="mb-10">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-medium">MCP 服务</h2>
        <Button size="xs" variant="outline" className="ml-auto" onClick={() => setEditing({ index: -1, entry: EMPTY_MCP })} disabled={editing !== null}><Plus />添加服务</Button>
      </div>
      <p className="mb-3 text-xs text-ink-muted">接入外部工具（文件、数据库、浏览器等）。每个工具首次调用前会先问你；「权限」设为全部允许时不再询问。服务返回的内容不受信任。</p>
      <div className="space-y-2">
        {editing && editing.index === -1 ? (
          <McpForm initial={editing.entry} onCancel={() => setEditing(null)}
            onSave={(entry) => void persist([...list, entry], `已添加 ${entry.name || '服务'}`)} />
        ) : null}
        {entries === null ? <p className="text-xs text-ink-muted">加载中…</p> : null}
        {entries !== null && list.length === 0 && !editing ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-4 text-sm text-ink-muted">还没有配置 MCP 服务。点「添加服务」，或在「插件」页导入带 MCP 的扩展包。</p>
        ) : null}
        {list.map((entry, index) => editing?.index === index ? (
          <McpForm key={entry.name} initial={editing.entry} onCancel={() => setEditing(null)}
            onSave={(next) => void persist(list.map((e, i) => (i === index ? next : e)), '已保存')} />
        ) : (
          <div key={entry.name} className={cn('flex items-start gap-3 rounded-2xl border border-line bg-paper-raised p-3.5', entry.disabled && 'opacity-60')}>
            <CatalogIcon name={entry.name} letterOnly className="h-9 w-9 text-xs" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{entry.name}</span>
                <span className="rounded-full bg-paper-inset px-1.5 py-0.5 text-[11px] text-ink-muted">{TRANSPORT_LABEL[entry.transport]}</span>
                {entry.transport === 'stdio' && /^(npx|node)(\s|$)/.test(entry.command?.trim() ?? '') && nodeStatus && !nodeStatus.available ? (
                  <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-600 dark:text-amber-400" title="未检测到 Node.js，运行此服务需要安装 Node.js">缺少 Node.js</span>
                ) : null}
                {entry.disabled ? <span className="text-[11px] text-ink-muted">已停用</span> : null}
              </div>
              <p className="mt-1 break-all font-mono text-xs text-ink-muted">{describeMcpEntry(entry)}</p>
              {entry.env || entry.headers ? (
                <p className="mt-1 break-all font-mono text-[11px] text-ink-muted/80">
                  {Object.entries(maskSecrets(entry.env ?? entry.headers) ?? {}).map(([k, v]) => `${k}=${v}`).join('  ')}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="xs" variant="outline" onClick={() => void persist(list.map((e, i) => (i === index ? { ...e, disabled: !e.disabled || undefined } : e)))}>{entry.disabled ? '启用' : '停用'}</Button>
              <Button
                size="icon-xs"
                variant="ghost"
                title="重新信任工具定义（重置此服务安全基线）"
                onClick={async () => {
                  try {
                    await window.reizo?.resetMcpBaseline?.(entry.name);
                    toast.success(`已重置「${entry.name}」的信任基线`);
                  } catch (cause) {
                    toast.error('重置基线失败', message(cause));
                  }
                }}
              >
                <ShieldCheck />
              </Button>
              <Button size="icon-xs" variant="ghost" title="编辑" onClick={() => setEditing({ index, entry })}><Pencil /></Button>
              <Button size="icon-xs" variant="ghost" title="删除" onClick={() => { void confirmDialog({ title: `删除 MCP 服务「${entry.name}」？`, confirmLabel: '删除', destructive: true }).then((ok) => { if (ok) void persist(list.filter((_, i) => i !== index), '已删除'); }); }}><Trash2 /></Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HookForm({ initial, onSave, onCancel }: { initial: HookEntry; onSave: (entry: HookEntry) => void; onCancel: () => void }) {
  const [event, setEvent] = useState<HookEntry['event']>(initial.event);
  const [matcher, setMatcher] = useState(initial.matcher ?? '');
  const [command, setCommand] = useState(initial.command);
  const [seconds, setSeconds] = useState(initial.timeoutMs ? String(Math.round(initial.timeoutMs / 1000)) : '');
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-paper-raised p-4">
      <div>
        <label className={LABEL}>触发时机</label>
        <div className="flex gap-1.5">
          {([['PreToolUse', '调用工具前（可拦截）'], ['PostToolUse', '调用工具后']] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setEvent(id)}
              className={cn('rounded-full px-3 py-1 text-xs transition-colors', event === id ? 'bg-ink text-paper-raised' : 'border border-line text-ink-muted hover:border-ink-muted')}>{label}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <div>
          <label className={LABEL}>工具匹配（正则，留空匹配所有工具）</label>
          <input className={FIELD} value={matcher} onChange={(e) => setMatcher(e.target.value)} placeholder="write_file|edit_file" />
        </div>
        <div>
          <label className={LABEL}>超时（秒）</label>
          <input className={FIELD} value={seconds} onChange={(e) => setSeconds(e.target.value.replace(/\D/g, ''))} placeholder="10" />
        </div>
      </div>
      <div>
        <label className={LABEL}>要运行的命令</label>
        <input className={cn(FIELD, 'font-mono text-xs')} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="node check.js" />
        <p className="mt-1.5 text-[11px] text-ink-muted">工具信息以 JSON 从标准输入传入。退出码 2 表示拦截（调用前）或把标准错误反馈给模型（调用后）。</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
        <Button size="sm" onClick={() => onSave({ event, matcher: matcher.trim(), command: command.trim(), ...(seconds ? { timeoutMs: Number(seconds) * 1000 } : {}) })}>保存</Button>
      </div>
    </div>
  );
}

function HooksBlock() {
  const [entries, setEntries] = useState<HookEntry[] | null>(null);
  const [editing, setEditing] = useState<{ index: number; entry: HookEntry } | null>(null);

  const load = useCallback(async () => {
    try { setEntries((await window.reizo?.listHooks?.()) ?? []); } catch (cause) { toast.error('读取 Hooks 失败', message(cause)); setEntries([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function persist(next: HookEntry[], done?: string) {
    try {
      if (window.reizo?.saveHooks) {
        await window.reizo.saveHooks(next);
      }
      setEntries(next);
      setEditing(null);
      if (done) toast.success(done);
    } catch (cause) { toast.error('保存失败', message(cause)); }
  }

  const list = entries ?? [];
  return (
    <section className="mb-10">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-medium">Hooks</h2>
        <Button size="xs" variant="outline" className="ml-auto" onClick={() => setEditing({ index: -1, entry: EMPTY_HOOK })} disabled={editing !== null}><Plus />添加 Hook</Button>
      </div>
      <p className="mb-3 text-xs text-ink-muted">在 Agent 调用工具前后运行你的命令：例如拦截对某些文件的写入，或改完文件后自动检查格式。命令以你的身份在本机运行，只写你信任的。</p>
      <div className="space-y-2">
        {editing && editing.index === -1 ? (
          <HookForm initial={editing.entry} onCancel={() => setEditing(null)} onSave={(entry) => void persist([...list, entry], '已添加 Hook')} />
        ) : null}
        {entries === null ? <p className="text-xs text-ink-muted">加载中…</p> : null}
        {entries !== null && list.length === 0 && !editing ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-4 text-sm text-ink-muted">还没有配置 Hook。</p>
        ) : null}
        {list.map((hook, index) => editing?.index === index ? (
          <HookForm key={index} initial={editing.entry} onCancel={() => setEditing(null)} onSave={(next) => void persist(list.map((h, i) => (i === index ? next : h)), '已保存')} />
        ) : (
          <div key={index} className="flex items-start gap-3 rounded-2xl border border-line bg-paper-raised p-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{describeHook(hook)}</p>
              <p className="mt-1 break-all font-mono text-xs text-ink-muted">{hook.command}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="icon-xs" variant="ghost" title="编辑" onClick={() => setEditing({ index, entry: hook })}><Pencil /></Button>
              <Button size="icon-xs" variant="ghost" title="删除" onClick={() => { void confirmDialog({ title: '删除这条 Hook？', confirmLabel: '删除', destructive: true }).then((ok) => { if (ok) void persist(list.filter((_, i) => i !== index), '已删除'); }); }}><Trash2 /></Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ExtensionsSection() {
  const [reloadNonce, setReloadNonce] = useState(0);
  const handleReload = () => setReloadNonce((n) => n + 1);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">扩展</h1>
      <p className="mb-8 text-sm text-ink-muted">
        MCP 服务和 Hooks 的修改从下一轮对话开始生效，不用重启。技能和扩展包在
        <button type="button" className="mx-0.5 text-accent underline-offset-2 hover:underline" onClick={() => uiStore.setMode('skills')}>插件页</button>
        管理。
      </p>
      <QuickIntegrationsBlock onChange={handleReload} />
      <McpBlock key={reloadNonce} />
      <HooksBlock />
    </div>
  );
}
