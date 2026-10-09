import { useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import { composeCanvasVideo } from '../../api';
import { useCanvasStore } from '../../state/useCanvasStore';
import { Button } from '../ui/button';
import { Field, FieldGroup, FieldLabel } from '../ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Alert, AlertDescription } from '../ui/alert';

const frames: Record<string, [number, number]> = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080] };

export default function CompositionExport({ sessionId, nodeIds, onAccepted }: { sessionId: string; nodeIds: string[]; onAccepted: () => void }) {
  const canvasId = useCanvasStore((state) => state.canvasIdBySession[sessionId]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [frame, setFrame] = useState('landscape');
  const [sourceVolume, setSourceVolume] = useState(1);
  const [audioVolume, setAudioVolume] = useState(0.8);
  const [error, setError] = useState('');
  const attempt = useRef<{ key: string; id: string } | undefined>(undefined);
  return <div className="relative">
    <Button variant="outline" size="sm" onClick={() => setOpen((value) => !value)} disabled={!canvasId || !nodeIds.length} aria-expanded={open}><Download data-icon="inline-start" />导出成片</Button>
    {open ? <form aria-label="导出成片设置" className="absolute right-0 top-full z-10 mt-2 flex w-72 flex-col gap-3 rounded-xl border border-line bg-paper-raised p-3 text-ink shadow-xl" onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape' && !busy) setOpen(false); }}
      onSubmit={(event) => {
        event.preventDefault(); if (busy || !canvasId) return;
        const [width, height] = frames[frame];
        const request = { nodeIds, width, height, sourceVolume, audioVolume };
        const key = JSON.stringify(request);
        if (attempt.current?.key !== key) attempt.current = { key, id: nanoid() };
        setBusy(true); setError('');
        void composeCanvasVideo(canvasId, request, attempt.current.id).then(() => { attempt.current = undefined; setOpen(false); onAccepted(); })
          .catch((error) => setError(error instanceof Error ? error.message : '导出未能开始')).finally(() => setBusy(false));
      }}>
      <div className="flex justify-between text-xs font-semibold"><span>按审片顺序拼接 {nodeIds.length} 个镜头</span><Button type="button" variant="ghost" size="icon-xs" aria-label="关闭导出设置" disabled={busy} onClick={() => setOpen(false)}><X /></Button></div>
      <FieldGroup className="gap-3"><Field><FieldLabel>输出画幅</FieldLabel><Select value={frame} onValueChange={setFrame} disabled={busy}><SelectTrigger aria-label="输出画幅"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="landscape">16:9 · 1080p</SelectItem><SelectItem value="portrait">9:16 · 1080p</SelectItem><SelectItem value="square">1:1 · 1080p</SelectItem></SelectGroup></SelectContent></Select></Field>
        <Field><FieldLabel htmlFor="composition-source-volume">原视频声音 · {Math.round(sourceVolume * 100)}%</FieldLabel><input id="composition-source-volume" type="range" min="0" max="2" step="0.05" value={sourceVolume} disabled={busy} onChange={(event) => setSourceVolume(Number(event.target.value))} /></Field>
        <Field><FieldLabel htmlFor="composition-audio-volume">连接的音轨 · {Math.round(audioVolume * 100)}%</FieldLabel><input id="composition-audio-volume" type="range" min="0" max="2" step="0.05" value={audioVolume} disabled={busy} onChange={(event) => setAudioVolume(Number(event.target.value))} /></Field>
      </FieldGroup>
      <p className="text-[11px] text-ink-muted">连接到每个视频节点的音频会混入该镜头，长音轨按镜头时长裁切，短音轨补静音。本地导出为 MP4，结果回到画布与素材库。</p>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <Button type="submit" size="sm" disabled={busy}>{busy ? '正在接收任务…' : '开始本地导出'}</Button>
    </form> : null}
  </div>;
}
