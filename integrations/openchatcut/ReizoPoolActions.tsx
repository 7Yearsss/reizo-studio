import { useState } from 'react';
import type { MediaAsset } from './types';
import { saveReizoSelectedMedia, useReizoPoolSelection } from './reizoMediaBridge';

export function ReizoPoolActions({ assets }: { assets: MediaAsset[] }) {
  useReizoPoolSelection(assets);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (window.parent === window) return null;
  return <div style={{ padding: '6px 10px', fontSize: 11 }}>
    <button disabled={busy || !assets.length} onClick={() => {
      const selected = [...assets]; setBusy(true); setMessage('正在保存…');
      void saveReizoSelectedMedia(selected).then(() => setMessage(`已保存 ${selected.length} 项素材到工作台`), (error) => setMessage(`保存未完成：${error.message}`)).finally(() => setBusy(false));
    }}>{busy ? '正在保存…' : `保存选中素材到工作台${assets.length ? ` (${assets.length})` : ''}`}</button>
    {message && <p role="status">{message}</p>}
  </div>;
}
