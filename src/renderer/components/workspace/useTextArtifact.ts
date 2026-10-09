import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArtifactWithContent } from '../../../shared/artifact';
import * as api from '../../api';
import { upsertArtifact } from '../../state/artifactStore';
import { clearEditorRecovery, getEditorRecovery, registerEditorFlusher, setEditorRecovery, trackEditorWrite } from '../../state/editorPersistence';

/** Owns saved-version concurrency and drafts, independently of the editor engine. */
export function useTextArtifact(artifact: ArtifactWithContent, beforeFlush?: () => void) {
  const prepare = useRef(beforeFlush); prepare.current = beforeFlush;
  const [initial] = useState(() => getEditorRecovery(artifact.id));
  const value = useRef(initial?.content ?? artifact.content);
  const version = useRef(initial?.expectedVersion ?? artifact.version);
  const dirty = useRef(Boolean(initial));
  const writing = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const [text, setText] = useState(value.current);
  const [source, setSource] = useState({ text: value.current, generation: 0 });
  const [error, setError] = useState(initial?.error ?? '');
  const [status, setStatus] = useState(initial ? '有未保存内容' : '已保存');
  const flush = useCallback((): Promise<void> => {
    prepare.current?.();
    clearTimeout(timer.current);
    if (writing.current) return writing.current;
    const task = Promise.resolve().then(async () => {
      while (dirty.current) {
        const snapshot = value.current;
        if (mounted.current) setStatus('正在保存…');
        const saved = await api.addArtifactVersion(artifact.id, snapshot, version.current);
        version.current = saved.version; dirty.current = value.current !== snapshot;
        if (!dirty.current) clearEditorRecovery(artifact.id);
        else setEditorRecovery(artifact.id, { sessionId: artifact.sessionId, content: value.current, expectedVersion: version.current });
        upsertArtifact(saved);
      }
      if (mounted.current) { setStatus('已保存'); setError(''); }
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : '保存失败';
      setEditorRecovery(artifact.id, { sessionId: artifact.sessionId, content: value.current, expectedVersion: version.current, error: message });
      if (mounted.current) { setError(message); setStatus('尚未保存'); }
      throw cause;
    }).finally(() => { writing.current = null; });
    writing.current = trackEditorWrite(artifact.sessionId, task); return task;
  }, [artifact.id, artifact.sessionId]);
  const load = useCallback((next: ArtifactWithContent) => {
    clearTimeout(timer.current); value.current = next.content; version.current = next.version; dirty.current = false;
    clearEditorRecovery(artifact.id); setText(next.content); setSource((previous) => ({ text: next.content, generation: previous.generation + 1 })); setStatus('已保存'); setError(''); upsertArtifact(next);
  }, [artifact.id]);
  useEffect(() => {
    if (artifact.version <= version.current) return;
    if (dirty.current) { setError('已有新版本，当前未保存内容已保留。请先下载恢复副本再重新载入。'); return; }
    load(artifact);
  }, [artifact, load]);
  useEffect(() => {
    mounted.current = true; const unregister = registerEditorFlusher(artifact.sessionId, artifact.id, flush);
    return () => { mounted.current = false; unregister(); clearTimeout(timer.current); void flush().catch((): void => { /* Preserved in recovery storage. */ }); };
  }, [artifact.id, artifact.sessionId, flush]);
  function change(next: string) {
    if (next === value.current) return;
    value.current = next; dirty.current = true; setText(next); setStatus('尚未保存');
    setEditorRecovery(artifact.id, { sessionId: artifact.sessionId, content: next, expectedVersion: version.current });
    clearTimeout(timer.current); timer.current = setTimeout(() => { void flush().catch((): void => { /* Rendered above. */ }); }, 700);
  }
  return { text, source, status, error, setError, flush, load, change, getVersion: () => version.current, getText: () => value.current, waitForSave: () => writing.current };
}
