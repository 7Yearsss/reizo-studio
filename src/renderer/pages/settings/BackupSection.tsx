import { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore, HardDriveDownload } from 'lucide-react';
import * as api from '../../api';
import { toast } from '../../lib/toast';

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Local backups of all conversations, canvases, artifacts and settings; restore takes effect after a restart. */
export default function BackupSection() {
  const [data, setData] = useState<api.BackupList | null>(null);
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<string | null>(null);

  const load = useCallback(() => { void api.listBackups().then(setData, () => setData({ backups: [], settings: { enabled: false, intervalHours: 24, keep: 7 } })); }, []);
  useEffect(load, [load]);

  async function backupNow() {
    setBusy(true);
    try { await api.createBackup(); toast.success('备份完成'); load(); }
    catch (error) { toast.error('备份失败', error instanceof Error ? error.message : undefined); }
    finally { setBusy(false); }
  }

  async function restore(name: string, createdAt: string) {
    if (!window.confirm(`恢复到 ${new Date(createdAt).toLocaleString()} 的备份？\n\n重启后生效：现在的数据会先被整体移到「restore-undo」文件夹（不会删除），再换上这份备份。恢复中途出问题会自动回滚。`)) return;
    try { await api.restoreBackup(name); setStaged(name); }
    catch (error) { toast.error('无法恢复', error instanceof Error ? error.message : undefined); }
  }

  const settings = data?.settings;
  const update = (patch: Partial<api.BackupSettings>): void => void api.saveBackupSettings(patch).then(load, (): void => { toast.error('保存失败'); });

  return (
    <section className="mb-8 max-w-3xl">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><HardDriveDownload size={16} /> 备份与恢复</h2>
      <p className="mb-3 text-sm text-ink-muted">把对话、画布、作品和设置备份到本机的备份文件夹。重装或换电脑前先备份一次。</p>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void backupNow()} disabled={busy} className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper-raised disabled:opacity-50">{busy ? '备份中…' : '立即备份'}</button>
        {settings ? (
          <label className="inline-flex items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" checked={settings.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
            自动备份，每
            <select aria-label="自动备份间隔" value={settings.intervalHours} onChange={(e) => update({ intervalHours: Number(e.target.value) })} className="rounded-full bg-paper-inset px-2 py-1 text-xs text-ink">
              {[6, 12, 24, 72, 168].map((h) => <option key={h} value={h}>{h < 24 ? `${h} 小时` : `${h / 24} 天`}</option>)}
            </select>
            ，保留
            <select aria-label="保留份数" value={settings.keep} onChange={(e) => update({ keep: Number(e.target.value) })} className="rounded-full bg-paper-inset px-2 py-1 text-xs text-ink">
              {[3, 7, 14, 30].map((n) => <option key={n} value={n}>{n} 份</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {staged ? (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-line bg-paper-raised px-3 py-2 text-sm">
          <ArchiveRestore size={15} className="text-accent" />
          <span className="flex-1">已安排恢复，重启后生效。</span>
          <button type="button" onClick={() => void window.reizo?.relaunchApp?.()} className="rounded-full bg-ink px-3 py-1 text-xs text-paper-raised">立即重启</button>
        </div>
      ) : null}

      {data && data.backups.length === 0 ? <p className="text-sm text-ink-muted">还没有备份。</p> : null}
      <ul className="space-y-1.5">
        {(data?.backups ?? []).map((backup) => (
          <li key={backup.name} className="flex items-center gap-3 rounded-xl border border-line bg-paper-raised px-3 py-2 text-sm">
            <span className="flex-1 text-ink">{new Date(backup.createdAt).toLocaleString()}</span>
            <span className="text-xs text-ink-muted">{size(backup.bytes)}</span>
            <button type="button" onClick={() => void restore(backup.name, backup.createdAt)} className="rounded-full px-3 py-1 text-xs text-ink-muted hover:text-ink">恢复</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
