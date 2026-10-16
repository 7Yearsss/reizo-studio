import { useEffect, useState } from 'react';
import { theme } from '../theme';

export function ReizoSpeechSettings() {
  const [open, setOpen] = useState(false), [ready, setReady] = useState(false);
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(() => (localStorage.getItem('cc.asrModel') || 'base') === 'base');
  useEffect(() => {
    if (!open) return;
    let live = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const [catalog, task] = await Promise.all([fetch('/api/asr-models').then(r => r.json()), fetch('/api/asr-models/download/base').then(r => r.json())]);
        if (!live) return;
        setReady(catalog.models?.find((m: { id: string }) => m.id === 'base')?.onnxDownloaded === true);
        setBusy(task.status === 'downloading');
        setNote(task.status === 'downloading' ? `下载中 ${Math.round(100 * task.bytesDone / Math.max(1, task.bytesTotal))}%` : task.status === 'error' ? task.error || '下载失败，可重试' : '');
      } catch { if (live) setNote('无法读取模型状态'); }
      finally { if (live) timer = setTimeout(poll, 2000); }
    };
    void poll(); return () => { live = false; clearTimeout(timer); };
  }, [open]);
  const download = async () => {
    setBusy(true); setNote('正在准备下载');
    try {
      const response = await fetch('/api/asr-models/download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'base' }) });
      if (!response.ok) throw new Error(`下载失败 (${response.status})`);
      localStorage.setItem('cc.asrModel', 'base');
      setSelected(true);
    } catch (error) { setNote(String(error)); setBusy(false); }
  };
  return <div style={{ position: 'relative' }}>
    <button onClick={() => setOpen(!open)} aria-expanded={open}>语音字幕</button>
    {open && <section aria-label="本地语音模型" style={{ position: 'absolute', right: 0, top: 28, zIndex: 100, width: 280, padding: 14, border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.bg }}>
      <strong>本地语音识别 · Whisper Base</strong>
      <p>首次下载约 351 MB。识别在本机运行，支持中文、英文。自动字幕仍需核对。</p>
      <p>{ready ? '模型已就绪' : '模型尚未就绪'} {note}</p>
      <button disabled={busy || ready} onClick={() => void download()}>{busy ? '正在下载…' : ready ? '已安装' : '下载模型'}</button>
      {ready && !selected && <button onClick={() => { localStorage.setItem('cc.asrModel', 'base'); setSelected(true); }}>使用 Base 模型</button>}
      <p>选中时间线片段，在对话中说“给这段添加中文字幕”。识别时保持剪辑面板打开。</p>
      <button onClick={() => setOpen(false)}>关闭</button>
    </section>}
  </div>;
}
