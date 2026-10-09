import { useEffect, useState, type ReactNode } from 'react';
import type { Artifact, ArtifactWithContent } from '../../../shared/artifact';
import * as api from '../../api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Alert, AlertDescription } from '../ui/alert';
import ArtifactVersionRail from './ArtifactVersionRail';

export default function ArtifactHistoryDialog({ artifact, close, flush, getVersion, restored, render }: {
  artifact: Artifact; close(): void; flush(): Promise<void>; getVersion(): number;
  restored(): Promise<void>; render(content: string): ReactNode;
}) {
  const [number, setNumber] = useState(artifact.version);
  const [snapshot, setSnapshot] = useState<ArtifactWithContent | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false; setSnapshot(null);
    void api.getArtifact(artifact.id, number).then((next) => { if (!cancelled) { setSnapshot(next); setError(''); } }, (cause) => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [artifact.id, number]);
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="flex h-[80vh] w-[90vw] max-w-5xl flex-col sm:max-w-5xl">
    <DialogHeader><DialogTitle>{artifact.name} · 版本历史</DialogTitle><DialogDescription>查看旧版本不会改动当前内容。恢复会创建新版本，保留现有记录。</DialogDescription></DialogHeader>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex min-h-0 flex-1 overflow-hidden"><div className="min-w-0 flex-1 overflow-auto">{snapshot ? render(snapshot.content) : <p role="status" className="p-4 text-xs">正在加载版本…</p>}</div>
      <ArtifactVersionRail artifactId={artifact.id} activeVersion={number} onPick={setNumber} onBeforeRestore={flush} getExpectedVersion={getVersion} onRestored={() => { void restored().then(close, (cause) => setError(String(cause))); }} />
    </div>
  </DialogContent></Dialog>;
}
