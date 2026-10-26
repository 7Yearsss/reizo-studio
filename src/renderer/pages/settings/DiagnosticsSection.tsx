import { useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import * as api from '../../api';
import { toast } from '../../lib/toast';

/** Exports a redacted support bundle (versions, settings, recent turn traces) to a file the user can inspect and send. */
export default function DiagnosticsSection() {
  const [busy, setBusy] = useState(false);

  async function exportBundle() {
    setBusy(true);
    try {
      const bundle = await api.getDiagnosticsBundle();
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `reizo-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error('导出失败', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-8 max-w-3xl">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><LifeBuoy size={16} /> 诊断</h2>
      <p className="mb-3 text-sm text-ink-muted">遇到问题时导出一份诊断包发给我们：包含版本、设置和最近几次回复的运行记录。密钥、令牌、密码和图片内容一律已抹去，发送前可以用文本编辑器打开检查。</p>
      <button type="button" onClick={() => void exportBundle()} disabled={busy} className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper-raised disabled:opacity-50">{busy ? '导出中…' : '导出诊断包'}</button>
    </section>
  );
}
