import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { Panel, useReactFlow } from '@xyflow/react';
import { ImagePlus, Link2, Pin, Library, Film, Music2, ImageIcon, X, RefreshCw, LoaderCircle } from 'lucide-react';
import { nanoid } from 'nanoid';
import { ANCHOR_ROLES, type CanvasAnchorParams, type CanvasNode } from '../../../shared/canvas';
import type { CanvasAssetSummary } from '../../../shared/canvasAssets';
import { canvasAssetUrl, listCanvasAssets, type ReusableMediaKind, type ReuseCanvasAssetInput } from '../../api';
import * as canvasStore from '../../state/canvasStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Skeleton } from '../ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../ui/empty';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const KIND_LABELS: Record<ReusableMediaKind, string> = { image: '图片', video: '视频', audio: '音频' };

function Thumb({ rel, kind = 'image' }: { rel: string | undefined; kind?: ReusableMediaKind }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    setUrl(null); setFailed(false);
    if (rel) void canvasAssetUrl(rel).then((value) => { if (current) setUrl(value); });
    return () => { current = false; };
  }, [rel]);
  if (url && kind === 'image' && !failed) return <img src={url} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} />;
  return <div className="flex size-full items-center justify-center bg-paper-inset/60 text-ink-muted">
    {kind === 'video' ? <Film size={18} /> : kind === 'audio' ? <Music2 size={18} /> : <ImageIcon size={18} />}
  </div>;
}

interface ReuseAction { input: ReuseCanvasAssetInput; key: string }
type ReuseHandler = (action: ReuseAction, asReference: boolean) => void;

function AssetActions({ action, image, busy, onReuse }: { action: ReuseAction; image: boolean; busy: boolean; onReuse: ReuseHandler }) {
  return <div className="flex flex-wrap gap-1">
    <Button type="button" variant="secondary" size="xs" disabled={busy} onClick={() => onReuse(action, false)}>
      {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}加入画布
    </Button>
    {image ? <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => onReuse(action, true)}>
      <Pin data-icon="inline-start" />引用此版本
    </Button> : null}
  </div>;
}

function CurrentMedia({ node, busy, onReuse }: { node: CanvasNode; busy: boolean; onReuse: ReuseHandler }) {
  const assets = node.output?.assets ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const active = assets[node.output?.activeAssetIndex ?? 0] ?? assets[0];
  const selected = picked && assets.includes(picked) ? picked : active;
  const assetIndex = assets.indexOf(selected);
  const version = node.output?.resultSet?.find((item) => item.asset === selected);
  const kind = node.type === 'frameExtractor' ? 'image' : node.type as ReusableMediaKind;
  const action: ReuseAction = { key: node.id, input: { ...(version?.assetId ? { assetId: version.assetId }
    : { sourceNodeId: node.id, sourceCanvasId: node.canvasId, assetIndex }), title: node.title || `${KIND_LABELS[kind]}素材` } };
  return <article className="flex flex-col gap-2 rounded-lg border border-line p-2">
    <div className="flex items-center gap-2">
      <div className="size-11 shrink-0 overflow-hidden rounded-md"><Thumb rel={selected} kind={kind} /></div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium text-ink">{node.title || `${KIND_LABELS[kind]}素材`}</div>
        <div className="text-[10px] text-ink-muted">{KIND_LABELS[kind]} · 第 {assetIndex + 1} / {assets.length} 项</div>
      </div>
    </div>
    {assets.length > 1 ? <div className="flex flex-wrap gap-1" aria-label={`${node.title || '素材'}的版本`}>
      {assets.map((asset, index) => <Button key={asset} type="button" size="xs" variant={asset === selected ? 'secondary' : 'ghost'}
        disabled={busy} aria-pressed={asset === selected} onClick={() => setPicked(asset)}>版本 {index + 1}</Button>)}
    </div> : null}
    <AssetActions action={action} image={kind === 'image'} busy={busy} onReuse={onReuse} />
  </article>;
}

function LibraryMedia({ asset, busy, onReuse }: { asset: CanvasAssetSummary; busy: boolean; onReuse: ReuseHandler }) {
  const kind = asset.kind as ReusableMediaKind;
  const date = new Date(asset.createdAt);
  const created = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  return <article className="flex flex-col gap-2 rounded-lg border border-line p-2">
    <div className="flex items-center gap-2">
      <div className="size-11 shrink-0 overflow-hidden rounded-md"><Thumb rel={asset.path} kind={kind} /></div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium text-ink">{asset.label || `${KIND_LABELS[kind]}素材`}</div>
        <div className="text-[10px] text-ink-muted">{KIND_LABELS[kind]}{created ? ` · ${created}` : ''}{asset.generation ? ` · 第${asset.generation}次生成` : ''}</div>
      </div>
    </div>
    <AssetActions action={{ key: asset.id, input: { assetId: asset.id, title: asset.label } }} image={kind === 'image'} busy={busy} onReuse={onReuse} />
  </article>;
}

function AssetShelf({ sessionId, selectedTargetIds, flash }: { sessionId: string; selectedTargetIds: string[]; flash: (message: string) => void }) {
  const flow = useReactFlow();
  const nodes = useCanvasStore((state) => state.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES);
  const anchors = useMemo(() => nodes.filter((node) => node.type === 'anchor'), [nodes]);
  const media = useMemo(() => nodes.filter((node) => ['image', 'video', 'audio', 'frameExtractor'].includes(node.type) && node.output?.assets?.length), [nodes]);
  const fileRef = useRef<HTMLInputElement>(null);
  const scope = useRef(sessionId); scope.current = sessionId;
  const busyRef = useRef(new Set<string>());
  const retries = useRef(new Map<string, { id: string; input: ReuseCanvasAssetInput }>());
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [opened, setOpened] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState('current');
  const [kind, setKind] = useState<ReusableMediaKind | 'all'>('all');
  const [refresh, setRefresh] = useState(0);
  const [actionError, setActionError] = useState<{ sessionId: string; message: string } | null>(null);
  const [library, setLibrary] = useState<{ sessionId: string; kind: string; assets: CanvasAssetSummary[]; loading: boolean; error: string | null }>({ sessionId: '', kind: '', assets: [], loading: true, error: null });
  const expanded = opened || anchors.length > 0 || dragOver;
  const keyFor = (key: string) => `${sessionId}:${key}`;

  useEffect(() => {
    if (!expanded || mode !== 'library') return;
    const abort = new AbortController();
    setLibrary({ sessionId, kind, assets: [], loading: true, error: null });
    void listCanvasAssets({ kind: kind === 'all' ? undefined : kind, limit: 80, signal: abort.signal }).then((assets) => {
      if (!abort.signal.aborted && scope.current === sessionId) setLibrary({ sessionId, kind, assets: assets.filter((asset) => asset.kind !== 'mask'), loading: false, error: null });
    }).catch((error: unknown) => {
      if (!abort.signal.aborted && scope.current === sessionId) setLibrary({ sessionId, kind, assets: [], loading: false, error: error instanceof Error ? error.message : '素材读取失败' });
    });
    return () => abort.abort();
  }, [expanded, mode, kind, sessionId, refresh]);

  const markBusy = (key: string, value: boolean) => {
    if (value) busyRef.current.add(key); else busyRef.current.delete(key);
    setBusy((current) => ({ ...current, [key]: value }));
  };

  const onReuse: ReuseHandler = (action, asReference) => {
    const busyKey = keyFor(action.key);
    if (busyRef.current.has(busyKey)) return;
    const actionScope = sessionId;
    const retryKey = `${busyKey}:${asReference}:${action.input.assetId ?? `${action.input.sourceNodeId}:${action.input.assetIndex}`}`;
    let attempt = retries.current.get(retryKey);
    if (!attempt) {
      const position = flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      attempt = { id: nanoid(), input: { ...action.input, ...position, asReference } };
      retries.current.set(retryKey, attempt);
    }
    markBusy(busyKey, true); setActionError(null);
    void canvasStore.reuseAsset(actionScope, attempt.input, attempt.id).then((node) => {
      retries.current.delete(retryKey);
      if (scope.current === actionScope) {
        if (!node) throw new Error('画布尚未加载，请稍后再试');
        flash(asReference ? '已添加固定版本引用' : '已加入画布');
      }
    }).catch((error: unknown) => {
      if (scope.current === actionScope) setActionError({ sessionId: actionScope, message: error instanceof Error ? error.message : '素材复用失败' });
    }).finally(() => markBusy(busyKey, false));
  };

  const addFiles = (files: File[]) => {
    const actionScope = sessionId;
    const key = keyFor('upload');
    if (busyRef.current.has(key)) return;
    const images = files.filter((file) => file.type.startsWith('image/')).slice(0, 6);
    if (!images.length) return;
    markBusy(key, true); setOpened(true);
    void Promise.all(images.map((file, index) => canvasStore.addAnchorFromFile(actionScope, file, { x: 40 + index * 24, y: 40 + index * 24 })))
      .catch(() => { if (scope.current === actionScope) flash('图钉创建失败'); }).finally(() => markBusy(key, false));
  };

  const fileInput = <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => {
    addFiles([...(event.target.files ?? [])]); event.target.value = '';
  }} />;

  if (!expanded) return <Panel position="top-right" className="!m-2">
    <Button type="button" variant="outline" size="sm" onClick={() => setOpened(true)} title="浏览当前画布素材或打开素材库"
      onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); addFiles([...event.dataTransfer.files]); }}>
      <Library data-icon="inline-start" />素材栏
    </Button>{fileInput}
  </Panel>;

  const scopedLibrary = library.sessionId === sessionId && library.kind === kind ? library : { ...library, assets: [], loading: true, error: null };
  return <Panel position="top-right" className="!m-2">
    <aside aria-label="素材栏" className={cn('w-64 rounded-xl border bg-paper-raised/95 p-2 shadow-xl backdrop-blur-md', dragOver ? 'border-accent border-dashed' : 'border-line')}
      onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragOver(false); addFiles([...event.dataTransfer.files]); }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-ink">素材栏</span>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="icon-xs" disabled={busy[keyFor('upload')]} onClick={() => fileRef.current?.click()} title="上传参考图片" aria-label="上传参考图片"><ImagePlus /></Button>
          {!anchors.length ? <Button type="button" variant="ghost" size="icon-xs" onClick={() => setOpened(false)} aria-label="收起素材栏"><X /></Button> : null}
        </div>
      </div>
      {actionError?.sessionId === sessionId ? <Alert variant="destructive" className="mb-2"><AlertTitle>复用未完成</AlertTitle><AlertDescription>{actionError.message}</AlertDescription></Alert> : null}
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList className="w-full"><TabsTrigger value="current">当前画布</TabsTrigger><TabsTrigger value="library">素材库</TabsTrigger></TabsList>
        <TabsContent value="current" className="max-h-[min(60vh,420px)] overflow-y-auto">
          <div className="flex flex-col gap-2">
            {anchors.map((anchor) => {
              const params = anchor.params as CanvasAnchorParams;
              const role = ANCHOR_ROLES.find((item) => item.id === (params.role ?? 'character'))?.label ?? '角色';
              return <div key={anchor.id} className="flex items-center gap-2 rounded-lg border border-line p-2">
                <button type="button" className="size-9 shrink-0 overflow-hidden rounded-md" onClick={() => canvasStore.focusNode(sessionId, anchor.id)} title="定位到该图钉"><Thumb rel={anchor.output?.assets?.[0]} /></button>
                <div className="min-w-0 flex-1"><div className="truncate text-[11px] font-medium text-ink">{anchor.title || '参考图钉'}</div><div className="text-[10px] text-ink-muted">{role}引用</div></div>
                <Button type="button" variant="ghost" size="icon-xs" disabled={!selectedTargetIds.length || busy[keyFor(anchor.id)]} title="连到选中的图片或视频" aria-label={`挂载${anchor.title || '参考图钉'}`}
                  onClick={() => { const key = keyFor(anchor.id); if (busyRef.current.has(key)) return; markBusy(key, true); void canvasStore.attachAnchor(sessionId, anchor.id, selectedTargetIds)
                    .then((count) => { if (scope.current === sessionId) flash(count > 0 ? `已挂到 ${count} 个节点` : '所选节点无法挂载'); })
                    .catch(() => { if (scope.current === sessionId) flash('引用挂载失败'); }).finally(() => markBusy(key, false)); }}><Link2 /></Button>
              </div>;
            })}
            {media.map((node) => <CurrentMedia key={`${sessionId}:${node.id}`} node={node} busy={Boolean(busy[keyFor(node.id)])} onReuse={onReuse} />)}
            {!anchors.length && !media.length ? <Empty><EmptyHeader><EmptyTitle>还没有画布素材</EmptyTitle><EmptyDescription>生成或上传素材后，可以在这里复用某个版本。</EmptyDescription></EmptyHeader></Empty> : null}
          </div>
        </TabsContent>
        <TabsContent value="library" className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <Select value={kind} onValueChange={(value) => setKind(value as ReusableMediaKind | 'all')}><SelectTrigger size="sm" aria-label="筛选素材类型" className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="all">全部素材</SelectItem><SelectItem value="image">图片</SelectItem><SelectItem value="video">视频</SelectItem><SelectItem value="audio">音频</SelectItem></SelectGroup></SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="刷新素材库" disabled={scopedLibrary.loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw /></Button>
          </div>
          <div className="max-h-[min(60vh,420px)] overflow-y-auto">
            {scopedLibrary.loading ? <div className="flex flex-col gap-2" role="status" aria-label="正在加载素材库"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
              : scopedLibrary.error ? <Alert variant="destructive"><AlertTitle>素材库暂时无法加载</AlertTitle><AlertDescription>{scopedLibrary.error}<Button type="button" variant="ghost" size="xs" onClick={() => setRefresh((value) => value + 1)}>重试</Button></AlertDescription></Alert>
                : scopedLibrary.assets.length ? <div className="flex flex-col gap-2">{scopedLibrary.assets.map((asset) => <LibraryMedia key={asset.id} asset={asset} busy={Boolean(busy[keyFor(asset.id)])} onReuse={onReuse} />)}</div>
                  : <Empty><EmptyHeader><EmptyTitle>素材库还没有内容</EmptyTitle><EmptyDescription>已保存的图片、视频和音频会出现在这里，供其它画布复用。</EmptyDescription></EmptyHeader></Empty>}
          </div>
        </TabsContent>
      </Tabs>
    </aside>{fileInput}
  </Panel>;
}

export default memo(AssetShelf);
