import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  FileCode2,
  FileJson,
  FilePlus2,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  RefreshCw,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import type { ArtifactKind } from '../../../shared/artifact';
import { inferArtifactKind, isBlobKind } from '../../../shared/artifact';
import { DOC_TEMPLATES } from '../../../shared/docTemplates';
import * as api from '../../api';
import { useArtifactStore } from '../../state/useArtifactStore';
import * as artifactStore from '../../state/artifactStore';
import ArtifactPreview from './ArtifactPreview';
import Tooltip from '../ui/Tooltip';
import { Loader } from '../motion/loader';
import { toast } from '../../lib/toast';

const KIND_LABELS: Record<ArtifactKind, string> = {
  markdown: 'Markdown',
  html: 'HTML',
  text: '文本',
  json: 'JSON',
  image: '图片',
  binary: '二进制',
  svg: 'SVG',
  diagram: '图表',
  code: '代码',
  video: '视频',
  audio: '音频',
  sketch: '手绘',
};

const SOURCE_LABELS: Record<string, string> = {
  attachment: '附件',
  generated: '生成',
  manual: '手动',
};

function KindIcon({ kind }: { kind: ArtifactKind }) {
  const cls = 'h-3.5 w-3.5 shrink-0 text-accent';
  if (kind === 'json') return <FileJson className={cls} />;
  if (kind === 'html') return <FileCode2 className={cls} />;
  if (kind === 'image') return <ImageIcon className={cls} />;
  return <FileText className={cls} />;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const swallow = (): undefined => undefined;
const swallowNull = (): null => null;

function readFileForUpload(file: File): Promise<{ content: string; mimeType: string; kind: ArtifactKind }> {
  const kind = inferArtifactKind(file.name, file.type || undefined);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () =>
      resolve({ content: String(reader.result ?? ''), mimeType: file.type || '', kind });
    if (isBlobKind(kind)) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

export default function ArtifactPanel({ sessionId }: { sessionId: string }) {
  const artifacts = useArtifactStore((s) => s.bySession[sessionId]) ?? [];
  const loading = useArtifactStore((s) => s.loadingBySession[sessionId]) ?? false;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [newMenu, setNewMenu] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function newFromTemplate(templateId: string) {
    setNewMenu(false);
    const tpl = DOC_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    const created = await api
      .createSessionArtifact(sessionId, {
        name: tpl.fileName,
        content: tpl.body,
        kind: 'markdown',
        source: 'manual',
      })
      .catch(swallowNull);
    await artifactStore.loadSessionArtifacts(sessionId);
    if (created) {
      setSelectedId(created.id);
      toast.success(`已创建「${tpl.fileName}」`);
    }
  }

  useEffect(() => {
    void artifactStore.loadSessionArtifacts(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (selectedId && !artifacts.some((a) => a.id === selectedId)) setSelectedId(null);
    setChecked((prev) => {
      const next = new Set([...prev].filter((id) => artifacts.some((a) => a.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [artifacts, selectedId]);

  const selected = useMemo(
    () => artifacts.find((a) => a.id === selectedId) ?? null,
    [artifacts, selectedId],
  );

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    await Promise.all(
      list.map(async (file) => {
        try {
          const { content, mimeType, kind } = await readFileForUpload(file);
          await api.createSessionArtifact(sessionId, {
            name: file.name,
            content,
            mimeType: mimeType || undefined,
            kind,
            source: 'attachment',
          });
        } catch {
          /* skip unreadable file */
        }
      }),
    );
    await artifactStore.loadSessionArtifacts(sessionId);
    toast.success(`已上传 ${list.length} 个作品`);
  }

  function toggleCheck(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteChecked() {
    const ids = [...checked];
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => api.deleteArtifact(id).catch(swallow)));
    setChecked(new Set());
    await artifactStore.loadSessionArtifacts(sessionId);
    toast.success(`已删除 ${ids.length} 个作品`);
  }

  async function downloadChecked() {
    for (const id of checked) {
      const full = await api.getArtifact(id).catch(swallowNull);
      const meta = artifacts.find((a) => a.id === id);
      if (!full || !meta) continue;
      const a = document.createElement('a');
      if (full.rawUrl) {
        a.href = await api.artifactRawUrl(id, meta.version);
      } else {
        const blob = new Blob([full.content], { type: meta.mimeType || 'text/plain' });
        a.href = URL.createObjectURL(blob);
      }
      a.download = meta.name;
      a.click();
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  const selecting = checked.size > 0 || picking;

  return (
    <div
      className={cn('relative flex h-full min-h-0 flex-col', dragOver && 'ring-2 ring-accent ring-inset')}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer?.files?.length) void upload(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
          <FolderKanban className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="truncate">本会话作品</span>
          {artifacts.length > 0 && (
            <span className="rounded-full bg-paper-inset px-1.5 text-[10px] font-medium tabular-nums">
              {artifacts.length}
            </span>
          )}
        </h2>
        <div className="relative flex items-center gap-0.5">
          <Tooltip content="新建文档">
            <button
              type="button"
              onClick={() => setNewMenu((v) => !v)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          {newMenu && (
            <div className="absolute right-0 top-8 z-20 w-36 rounded-lg border border-line bg-paper-raised py-1 shadow-lg">
              {DOC_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void newFromTemplate(t.id)}
                  className="block w-full px-3 py-1.5 text-left text-[11px] hover:bg-paper-inset"
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <Tooltip content="上传文件">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="多选模式">
            <button
              type="button"
              onClick={() => setPicking((v) => !v)}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-paper-inset hover:text-ink transition-colors',
                selecting ? 'text-accent' : 'text-ink-muted',
              )}
            >
              <CheckSquare className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="刷新列表">
            <button
              type="button"
              onClick={() => void artifactStore.loadSessionArtifacts(sessionId)}
              disabled={loading}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-paper-inset hover:text-ink disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
          </Tooltip>
        </div>
      </div>

      {checked.size > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-paper-inset/40 px-3 py-1.5 text-[11px]">
          <span className="text-ink-muted">已选 {checked.size}</span>
          <button type="button" onClick={() => void downloadChecked()} className="rounded px-1.5 py-0.5 hover:bg-paper-inset">
            下载
          </button>
          <button
            type="button"
            onClick={() => void deleteChecked()}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-red-500 hover:bg-red-500/10"
          >
            <Trash2 size={11} /> 删除
          </button>
          <button type="button" onClick={() => setChecked(new Set())} className="ml-auto rounded px-1.5 py-0.5 hover:bg-paper-inset">
            清除
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && artifacts.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-6 text-xs text-ink-muted">
            <Loader variant="spinner" size={14} />
            加载中…
          </div>
        ) : artifacts.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <FolderKanban className="mx-auto h-6 w-6 text-ink-muted/50" />
            <p className="mt-2 text-xs text-ink-muted">暂无作品</p>
            <p className="mt-1 text-[11px] leading-4 text-ink-muted">
              拖文件到这里 · 图片、文档、参考；Agent 写入的文件也会出现在这里
            </p>
          </div>
        ) : (
          <ul className="flex flex-col p-2">
            {artifacts.map((a) => (
              <li key={a.id} className="flex items-stretch gap-1">
                {selecting && (
                  <button
                    type="button"
                    onClick={() => toggleCheck(a.id)}
                    className="flex shrink-0 items-center px-1 text-ink-muted hover:text-ink"
                    aria-label="选择"
                  >
                    {checked.has(a.id) ? (
                      <CheckSquare size={13} className="text-accent" />
                    ) : (
                      <Square size={13} />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (selecting ? toggleCheck(a.id) : setSelectedId(a.id))}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-xl px-2.5 py-2.5 text-left hover:bg-paper-inset/70',
                    selectedId === a.id && 'bg-paper-inset',
                  )}
                >
                  <KindIcon kind={a.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-xs font-medium">
                      <span className="truncate">{a.name}</span>
                      {a.versionCount > 1 && (
                        <span className="shrink-0 rounded bg-paper-inset px-1 text-[9px] font-medium tabular-nums text-ink-muted">
                          v{a.version}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-muted">
                      {KIND_LABELS[a.kind]} · {SOURCE_LABELS[a.source] ?? a.source} · {formatTime(a.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-paper/70">
          <span className="rounded-lg border border-dashed border-accent px-4 py-2 text-xs text-accent">
            松开以上传
          </span>
        </div>
      )}

      {selected && !selecting ? (
        <div className="flex max-h-[55%] min-h-[140px] shrink-0 flex-col border-t border-line">
          <ArtifactPreview artifact={selected} onClose={() => setSelectedId(null)} />
        </div>
      ) : null}
    </div>
  );
}
