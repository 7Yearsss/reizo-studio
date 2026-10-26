import { useState, type ReactElement } from 'react';
import { Cpu } from 'lucide-react';
import type { LocalDiscovery } from '../../../shared/localModels';
import * as api from '../../api';
import * as settingsStore from '../../state/settingsStore';
import { toast } from '../../lib/toast';

/** "检测本地模型": finds Ollama / LM Studio on this machine and connects one with a click. */
export default function LocalModelsBlock(): ReactElement {
  const [servers, setServers] = useState<LocalDiscovery[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function detect(): Promise<void> {
    setBusy(true);
    try { setServers(await api.discoverLocalModels()); }
    catch (error) { toast.error('检测失败', error instanceof Error ? error.message : undefined); }
    finally { setBusy(false); }
  }

  async function connect(server: LocalDiscovery): Promise<void> {
    try {
      const result = await api.connectLocalModel(server.providerId);
      await settingsStore.loadSettings();
      toast.success(`已接入 ${server.name}`, `当前模型：${result.model}`);
    } catch (error) {
      toast.error('接入失败', error instanceof Error ? error.message : undefined);
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-line bg-paper-raised p-3">
      <div className="flex items-center gap-3">
        <Cpu size={15} className="text-ink-muted" aria-hidden />
        <span className="flex-1 text-xs text-ink-muted">在本机运行 Ollama 或 LM Studio 时，无需填写密钥和地址，数据不离开这台电脑。</span>
        <button type="button" onClick={() => void detect()} disabled={busy} className="rounded-full bg-ink px-3 py-1 text-xs text-paper-raised disabled:opacity-50">{busy ? '检测中…' : '检测本地模型'}</button>
      </div>
      {servers && (
        <ul className="mt-3 space-y-1.5">
          {servers.map((server) => (
            <li key={server.providerId} className="flex items-center gap-3 rounded-lg bg-paper-inset/60 px-3 py-2 text-xs">
              <span className="w-20 shrink-0 font-medium text-ink">{server.name}</span>
              <span className="min-w-0 flex-1 truncate text-ink-muted" title={server.models.map((m) => m.id).join(', ')}>
                {server.reachable ? (server.models.length ? `${server.models.length} 个模型：${server.models.slice(0, 3).map((m) => m.id).join('、')}${server.models.length > 3 ? '…' : ''}` : '已运行，但还没有可对话的模型（先下载一个）') : server.message}
              </span>
              {server.reachable && server.models.length > 0 && <button type="button" onClick={() => void connect(server)} className="shrink-0 rounded-full bg-paper px-3 py-1 text-ink hover:bg-paper-raised">接入并设为默认</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
