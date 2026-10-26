import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import * as api from '../../api';
import { toast } from '../../lib/toast';

function label(name: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
  return m ? `${m[1]} / ${m[2]}` : name;
}

/** MCP tools you chose to always allow. Each can be taken back; the next call asks again. Renders nothing when empty. */
export default function AlwaysAllowedTools() {
  const [tools, setTools] = useState<string[]>([]);
  const load = useCallback(() => { void api.listAlwaysAllowed().then(setTools, (): void => setTools([])); }, []);
  useEffect(load, [load]);
  if (tools.length === 0) return null;
  return (
    <section className="mb-8 max-w-3xl">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><ShieldCheck size={16} /> 始终允许的外部工具</h2>
      <p className="mb-3 text-sm text-ink-muted">这些 MCP 工具不再逐次询问。撤销后，下次调用会重新征求你的同意。</p>
      <ul className="space-y-1">
        {tools.map((name) => (
          <li key={name} className="flex items-center gap-3 rounded-lg bg-paper-inset/60 px-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate" title={name}>{label(name)}</span>
            <button type="button" onClick={() => void api.revokeAlwaysAllowed(name).then(load, (): void => { toast.error('撤销失败'); })} className="text-xs text-ink-muted hover:text-danger">撤销</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
