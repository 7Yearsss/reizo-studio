import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { Panel, useReactFlow, useStoreApi } from '@xyflow/react';
import { ArrowUpRight, ImagePlus, Link2, Pin, Library, Film, Music2, ImageIcon, RefreshCw, LoaderCircle, SlidersHorizontal, FolderOpen, Plus } from 'lucide-react';
import { nanoid } from 'nanoid';
import { ANCHOR_ROLES, type CanvasAnchorParams, type CanvasNode } from '../../../shared/canvas';
import type { CanvasAssetSummary } from '../../../shared/canvasAssets';
import { canvasAssetUrl, canvasAssetLibraryPage, type ReusableMediaKind, type ReuseCanvasAssetInput } from '../../api';
import * as canvasStore from '../../state/canvasStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import AssetMetadataEditor from './AssetMetadataEditor';
import CanvasUtilityPanel from './CanvasUtilityPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Skeleton } from '../ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Field, FieldGroup, FieldLabel } from '../ui/field';
import { Separator } from '../ui/separator';
import { Tooltip } from '../ui/Tooltip';

const KIND_LABELS: Record<ReusableMediaKind, string> = { image: '图片', video: '视频', audio: '音频' };

function Thumb({ rel, kind = 'image' }: { rel: string | undefined; kind?: ReusableMediaKind }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    setUrl(null); setFailed(false);
    if (rel) void canvasAssetUrl(rel).then((value) => { if (current) setUrl(value); }).catch(() => { if (current) setFailed(true); });
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
  return <div className="flex items-center justify-between gap-1">
    <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => onReuse(action, false)} aria-label={`将${action.input.title || '素材'}加入画布`}>
      {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Plus data-icon="inline-start" />}{busy ? '正在加入' : '加入画布'}
    </Button>
    {image ? <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"><Tooltip content="将此版本固定为参考图钉"><Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => onReuse(action, true)} aria-label={`引用${action.input.title || '图片'}的此版本`}><Pin data-icon="inline-start" />引用</Button></Tooltip></div> : null}
  </div>;
}

function CurrentMedia({ node, busy, onReuse, onFocus }: { node: CanvasNode; busy: boolean; onReuse: ReuseHandler; onFocus: () => void }) {
  const assets = node.output?.assets ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const active = assets[node.output?.activeAssetIndex ?? 0] ?? assets[0];
  const selected = picked && assets.includes(picked) ? picked : active;
  const assetIndex = assets.indexOf(selected);
  const version = node.output?.resultSet?.find((item) => item.asset === selected);
  const kind = node.type === 'frameExtractor' ? 'image' : node.type as ReusableMediaKind;
  const action: ReuseAction = { key: node.id, input: { ...(version?.assetId ? { assetId: version.assetId }
    : { sourceNodeId: node.id, sourceCanvasId: node.canvasId, assetIndex }), title: node.title || `${KIND_LABELS[kind]}素材` } };
  return <article aria-busy={busy} className="group flex flex-col gap-2 rounded-xl p-2.5 transition-colors hover:bg-paper-inset/25 focus-within:bg-paper-inset/25 motion-reduce:transition-none">
    <div className="flex items-start gap-3">
      <button type="button" onClick={onFocus} aria-label={`定位到${node.title || KIND_LABELS[kind]}`} className="size-12 shrink-0 overflow-hidden rounded-lg outline-none ring-offset-2 ring-offset-paper-raised focus-visible:ring-2 focus-visible:ring-ring"><Thumb rel={selected} kind={kind} /></button>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onFocus} className="flex max-w-full items-center gap-1 rounded text-left text-[12px] font-medium text-ink outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-ring" title="定位到原节点"><span className="truncate">{node.title || `${KIND_LABELS[kind]}素材`}</span><ArrowUpRight size={11} className="shrink-0 opacity-0 group-hover:opacity-60 group-focus-within:opacity-60" /></button>
        <div className="mt-1 text-[11px] text-ink-muted">{KIND_LABELS[kind]}{assets.length > 1 ? `，${assets.length} 个版本` : ''}</div>
      </div>
    </div>
    {assets.length > 1 ? <Select value={String(assetIndex)} disabled={busy} onValueChange={(value) => setPicked(assets[Number(value)])}>
      <SelectTrigger size="sm" aria-label={`${node.title || '素材'}的版本`} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{assets.map((asset, index) => <SelectItem key={`${asset}:${index}`} value={String(index)}>版本 {index + 1}{asset === active ? '（当前）' : ''}</SelectItem>)}</SelectGroup></SelectContent>
    </Select> : null}
    <AssetActions action={action} image={kind === 'image'} busy={busy} onReuse={onReuse} />
  </article>;
}

function LibraryMedia({ asset, busy, onReuse, onSaved }: { asset: CanvasAssetSummary; busy: boolean; onReuse: ReuseHandler; onSaved: () => void }) {
  const kind = asset.kind as ReusableMediaKind;
  const date = new Date(asset.createdAt);
  const created = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  const size = asset.byteSize < 1024 ? `${asset.byteSize} B` : asset.byteSize < 1024 * 1024 ? `${Math.round(asset.byteSize / 1024)} KB` : `${(asset.byteSize / (1024 * 1024)).toFixed(1)} MB`;
  return <article aria-busy={busy} className="group relative flex flex-col gap-2 rounded-xl p-2.5 transition-colors hover:bg-paper-inset/25 focus-within:bg-paper-inset/25 motion-reduce:transition-none">
    <div className="flex items-start gap-3">
      <div className="size-12 shrink-0 overflow-hidden rounded-lg"><Thumb rel={asset.path} kind={kind} /></div>
      <div className="min-w-0 flex-1">
        <div className="truncate pr-5 text-[12px] font-medium text-ink" title={asset.label}>{asset.label || `${KIND_LABELS[kind]}素材`}</div>
        <div className="mt-1 text-[11px] text-ink-muted">{KIND_LABELS[kind]}{created ? `，${created}` : ''}{asset.generation ? `，第 ${asset.generation} 次生成` : ''}</div>
        <div className="mt-1 truncate text-[10px] text-ink-muted" title={`来源：${asset.source === 'generated' ? '生成' : '本地导入'}；平台：${asset.providerId || '未记录'}；模型：${asset.model || '未记录'}；画布 ${asset.canvasId}；节点 ${asset.nodeId || '已删除'}；任务 ${asset.jobId || '导入'}`}>
          {asset.source === 'generated' ? asset.model || asset.providerId || '模型生成' : '本地导入'}{` / ${size}`}
        </div>
      </div>
    </div>
    {asset.folder || asset.tags?.length ? <div className="flex min-w-0 items-center gap-2 text-[10px] text-ink-muted">{asset.folder ? <span className="flex min-w-0 items-center gap-1" title={asset.folder}><FolderOpen size={11} className="shrink-0" /><span className="max-w-28 truncate">{asset.folder}</span></span> : null}{asset.tags?.slice(0, 2).map((tag) => <span key={tag} className="max-w-20 truncate" title={tag}>#{tag}</span>)}{asset.tags?.length > 2 ? <span className="shrink-0" title={asset.tags.join('，')}>+{asset.tags.length - 2}</span> : null}</div> : null}
    <AssetMetadataEditor asset={asset} onSaved={onSaved} />
    <AssetActions action={{ key: asset.id, input: { assetId: asset.id, title: asset.label } }} image={kind === 'image'} busy={busy} onReuse={onReuse} />
  </article>;
}

function AssetShelf({ sessionId, selectedTargetIds, flash, open, onOpenChange, hideTrigger = false, position = 'top-right', initialMode = 'current' }: {
  sessionId: string; selectedTargetIds: string[]; flash: (message: string) => void;
  open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean; position?: 'top-left' | 'top-right';
  initialMode?: 'current' | 'library';
}) {
  const flow = useReactFlow();
  const flowStore = useStoreApi();
  const nodes = useCanvasStore((state) => state.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES);
  const anchors = useMemo(() => nodes.filter((node) => node.type === 'anchor'), [nodes]);
  const media = useMemo(() => nodes.filter((node) => ['image', 'video', 'audio', 'frameExtractor'].includes(node.type) && node.output?.assets?.length), [nodes]);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scope = useRef(sessionId); scope.current = sessionId;
  const busyRef = useRef(new Set<string>());
  const retries = useRef(new Map<string, { id: string; input: ReuseCanvasAssetInput }>());
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [opened, setOpened] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<string>(initialMode);
  const [kind, setKind] = useState<ReusableMediaKind | 'all'>('all');
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState('*');
  const [tag, setTag] = useState('');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const filterKey = JSON.stringify([sessionId, kind, search, folder, tag]);
  const filterScope = useRef(filterKey); filterScope.current = filterKey;
  const [actionError, setActionError] = useState<{ sessionId: string; message: string } | null>(null);
  const [library, setLibrary] = useState<{ sessionId: string; kind: string; assets: CanvasAssetSummary[]; loading: boolean; error: string | null; nextCursor?: string; folders?: string[]; filterKey?: string }>({ sessionId: '', kind: '', assets: [], loading: true, error: null });
  const setShelfOpen = (value: boolean) => { setOpened(value); onOpenChange?.(value); };
  const expanded = (open ?? opened) || dragOver;
  useEffect(() => { if (open === undefined && anchors.length) setOpened(true); }, [anchors.length, sessionId, open]);
  const keyFor = (key: string) => `${sessionId}:${key}`;

  useEffect(() => {
    if (!expanded || mode !== 'library') return;
    const abort = new AbortController();
    setLibrary((current) => current.sessionId === sessionId && current.filterKey === filterKey
      ? { ...current, loading: true, error: null }
      : { sessionId, kind, filterKey, assets: [], loading: true, error: null });
    setMoreLoading(false);
    const timer = setTimeout(() => {
      void canvasAssetLibraryPage({ kind: kind === 'all' ? undefined : kind, limit: 40, search,
        folder: folder === '*' ? undefined : folder === '__unfiled' ? '' : folder, tag: tag.trim() || undefined, signal: abort.signal }).then((page) => {
        if (!abort.signal.aborted && filterScope.current === filterKey) setLibrary({ sessionId, kind, filterKey, ...page, loading: false, error: null });
      }).catch((error: unknown) => {
        if (!abort.signal.aborted && filterScope.current === filterKey) setLibrary((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : '素材读取失败' }));
      });
    }, 180);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [expanded, mode, kind, sessionId, refresh, search, folder, tag, filterKey]);

  const loadMore = () => {
    if (!library.nextCursor || library.loading || library.filterKey !== filterKey || moreLoading) return;
    setMoreLoading(true);
    void canvasAssetLibraryPage({ kind: kind === 'all' ? undefined : kind, limit: 40, cursor: library.nextCursor, search,
      folder: folder === '*' ? undefined : folder === '__unfiled' ? '' : folder, tag: tag.trim() || undefined }).then((page) => {
      if (filterScope.current !== filterKey) return;
      setLibrary((current) => ({ ...current, nextCursor: page.nextCursor,
        assets: [...current.assets, ...page.assets.filter((asset) => !current.assets.some((known) => known.id === asset.id))] }));
    }).catch((error: unknown) => {
      if (filterScope.current === filterKey) setLibrary((current) => ({ ...current, error: error instanceof Error ? error.message : '更多素材读取失败' }));
    }).finally(() => { if (filterScope.current === filterKey) setMoreLoading(false); });
  };

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
      const bounds = flowStore.getState().domNode?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) { setActionError({ sessionId: actionScope, message: '画布尚未就绪，请稍后再试' }); return; }
      const position = flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
      attempt = { id: nanoid(), input: { ...action.input, ...position, asReference } };
      retries.current.set(retryKey, attempt);
    }
    markBusy(busyKey, true); setActionError(null);
    void canvasStore.reuseAsset(actionScope, attempt.input, attempt.id).then((node) => {
      if (!node) throw new Error('画布尚未加载，请稍后再试');
      retries.current.delete(retryKey);
      if (scope.current === actionScope) {
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
    markBusy(key, true); setShelfOpen(true);
    void Promise.all(images.map((file, index) => canvasStore.addAnchorFromFile(actionScope, file, { x: 40 + index * 24, y: 40 + index * 24 })))
      .catch(() => { if (scope.current === actionScope) flash('图钉创建失败'); }).finally(() => markBusy(key, false));
  };

  const fileInput = <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => {
    addFiles([...(event.target.files ?? [])]); event.target.value = '';
  }} />;

  const panelClass = cn('!m-3', position === 'top-left' && '!ml-[60px]');
  if (!expanded) return hideTrigger ? fileInput : <Panel position={position} className={panelClass}>
    <Tooltip content="浏览画布素材和素材库"><Button type="button" variant="outline" size="sm" onClick={() => setShelfOpen(true)} aria-label="打开素材栏"
      onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); addFiles([...event.dataTransfer.files]); }}>
      <Library data-icon="inline-start" />素材栏
    </Button></Tooltip>{fileInput}
  </Panel>;

  const scopedLibrary = library.sessionId === sessionId && library.kind === kind && library.filterKey === filterKey ? library : { ...library, assets: [], loading: true, error: null };
  const activeFilters = Number(folder !== '*') + Number(Boolean(tag.trim()));
  const hasQuery = Boolean(search.trim() || activeFilters || kind !== 'all');
  const resetFilters = () => { setSearch(''); setKind('all'); setFolder('*'); setTag(''); requestAnimationFrame(() => searchRef.current?.focus()); };
  const close = () => { setDragOver(false); setShelfOpen(false); };
  return <Panel position={position} className={panelClass}>
    <CanvasUtilityPanel title="素材栏" icon={Library} description={mode === 'current' ? `${anchors.length} 个图钉，${media.length} 个产物` : '跨画布复用已保存的作品'} onClose={close} className={cn(dragOver && 'border-accent border-dashed')}
      actions={<Tooltip content="上传参考图片"><Button type="button" variant="ghost" size="icon-xs" disabled={busy[keyFor('upload')]} onClick={() => fileRef.current?.click()} aria-label="上传参考图片">{busy[keyFor('upload')] ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <ImagePlus />}</Button></Tooltip>}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close(); } }}
      onDragOver={(event) => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) setDragOver(true); }}
      onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragOver(false); }}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragOver(false); addFiles([...event.dataTransfer.files]); }}>
      {dragOver ? <p className="px-4 pt-3 text-[12px] font-medium text-accent" role="status">松开鼠标，添加参考图片</p> : null}
      {actionError?.sessionId === sessionId ? <div className="shrink-0 px-3 pt-3"><Alert variant="destructive"><AlertTitle>素材未能加入</AlertTitle><AlertDescription className="min-w-0 max-h-28 overflow-y-auto [overflow-wrap:anywhere]">{actionError.message}<Button type="button" variant="ghost" size="xs" onClick={() => setActionError(null)}>知道了</Button></AlertDescription></Alert></div> : null}
      <Tabs value={mode} onValueChange={setMode} className="min-h-0 gap-0">
        <div className="shrink-0 px-4 py-2"><TabsList variant="line" className="w-full"><TabsTrigger value="current">当前画布</TabsTrigger><TabsTrigger value="library">素材库</TabsTrigger></TabsList></div>
        <TabsContent value="current" className="min-h-0 overflow-y-auto px-2 pb-2">
          <div className="flex flex-col gap-1">
            {anchors.length ? <div className="flex items-center justify-between px-2 pb-1 pt-2 text-[11px] text-ink-muted"><span>参考图钉</span><span>{anchors.length}</span></div> : null}
            {anchors.map((anchor) => {
              const params = anchor.params as CanvasAnchorParams;
              const role = ANCHOR_ROLES.find((item) => item.id === (params.role ?? 'character'))?.label ?? '角色';
              return <div key={anchor.id} className="group flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-paper-inset/25 focus-within:bg-paper-inset/25 motion-reduce:transition-none">
                <button type="button" className="size-10 shrink-0 overflow-hidden rounded-lg outline-none ring-offset-2 ring-offset-paper-raised focus-visible:ring-2 focus-visible:ring-ring" onClick={() => canvasStore.focusNode(sessionId, anchor.id)} title="定位到该图钉" aria-label={`定位到${anchor.title || '参考图钉'}`}><Thumb rel={anchor.output?.assets?.[0]} /></button>
                <button type="button" onClick={() => canvasStore.focusNode(sessionId, anchor.id)} className="min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="truncate text-[12px] font-medium text-ink">{anchor.title || '参考图钉'}</div><div className="mt-1 text-[11px] text-ink-muted">{role}引用</div></button>
                <Tooltip content={selectedTargetIds.length ? '挂载到选中的图片或视频' : '先选中图片或视频节点'}><Button type="button" variant="ghost" size="icon-xs" disabled={!selectedTargetIds.length || busy[keyFor(anchor.id)]} aria-label={`挂载${anchor.title || '参考图钉'}`}
                  onClick={() => { const key = keyFor(anchor.id); if (busyRef.current.has(key)) return; markBusy(key, true); void canvasStore.attachAnchor(sessionId, anchor.id, selectedTargetIds)
                    .then((count) => { if (scope.current === sessionId) flash(count > 0 ? `已挂到 ${count} 个节点` : '所选节点无法挂载'); })
                    .catch(() => { if (scope.current === sessionId) flash('引用挂载失败'); }).finally(() => markBusy(key, false)); }}><Link2 /></Button></Tooltip>
              </div>;
            })}
            {anchors.length && media.length ? <Separator className="my-2" /> : null}
            {media.length ? <div className="flex items-center justify-between px-2 pb-1 pt-2 text-[11px] text-ink-muted"><span>画布产物</span><span>{media.length}</span></div> : null}
            {media.map((node) => <CurrentMedia key={`${sessionId}:${node.id}`} node={node} busy={Boolean(busy[keyFor(node.id)])} onReuse={onReuse} onFocus={() => canvasStore.focusNode(sessionId, node.id)} />)}
            {!anchors.length && !media.length ? <Empty className="py-8"><EmptyHeader><EmptyMedia variant="icon"><ImagePlus /></EmptyMedia><EmptyTitle>把灵感放进画布</EmptyTitle><EmptyDescription>上传参考图片，或从素材库加入已有作品。生成结果也会保留在这里。</EmptyDescription></EmptyHeader><EmptyContent><Button type="button" variant="outline" size="sm" disabled={busy[keyFor('upload')]} onClick={() => fileRef.current?.click()}><ImagePlus data-icon="inline-start" />上传参考图片</Button><Button type="button" variant="ghost" size="xs" onClick={() => setMode('library')}>浏览素材库</Button></EmptyContent></Empty> : null}
          </div>
        </TabsContent>
        <TabsContent value="library" className="flex min-h-0 flex-col gap-0">
          <div className="min-h-0 overflow-y-auto">
          <FieldGroup className="shrink-0 gap-2 px-4 pb-3 pt-1">
            <Field><FieldLabel className="sr-only" htmlFor={`asset-search-${sessionId}`}>搜索素材</FieldLabel><Input ref={searchRef} id={`asset-search-${sessionId}`} type="search" placeholder="搜索名称、标签或模型" value={search} onChange={(event) => setSearch(event.target.value)} /></Field>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={kind} onValueChange={(value) => setKind(value as ReusableMediaKind | 'all')}><SelectTrigger size="sm" aria-label="筛选素材类型" className="flex-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup><SelectItem value="all">全部类型</SelectItem><SelectItem value="image">图片</SelectItem><SelectItem value="video">视频</SelectItem><SelectItem value="audio">音频</SelectItem></SelectGroup></SelectContent>
              </Select>
              <Button type="button" variant={activeFilters ? 'secondary' : 'ghost'} size="sm" onClick={() => setFiltersExpanded((value) => !value)} aria-expanded={filtersExpanded} aria-controls={`asset-filters-${sessionId}`}><SlidersHorizontal data-icon="inline-start" />筛选{activeFilters ? ` (${activeFilters})` : ''}</Button>
            </div>
            {filtersExpanded ? <FieldGroup id={`asset-filters-${sessionId}`} className="gap-2">
              <Field className="gap-1.5"><FieldLabel htmlFor={`asset-folder-${sessionId}`}>目录</FieldLabel><Select value={folder} onValueChange={setFolder}><SelectTrigger id={`asset-folder-${sessionId}`} size="sm" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup><SelectItem value="*">全部目录</SelectItem><SelectItem value="__unfiled">未分类</SelectItem>{scopedLibrary.folders?.map((entry) => <SelectItem key={entry} value={entry}>{entry}</SelectItem>)}</SelectGroup></SelectContent>
              </Select></Field>
              <Field className="gap-1.5"><FieldLabel htmlFor={`asset-tag-${sessionId}`}>标签</FieldLabel><Input id={`asset-tag-${sessionId}`} placeholder="例如：产品" value={tag} onChange={(event) => setTag(event.target.value)} /></Field>
            </FieldGroup> : activeFilters ? <p className="truncate text-[11px] text-ink-muted" title={`${folder !== '*' ? `目录：${folder === '__unfiled' ? '未分类' : folder}` : ''} ${tag ? `标签：${tag}` : ''}`}>{folder !== '*' ? `目录：${folder === '__unfiled' ? '未分类' : folder}` : ''}{folder !== '*' && tag ? ' / ' : ''}{tag ? `标签：${tag}` : ''}</p> : null}
          </FieldGroup>
          <Separator />
          <div className="px-2 py-2" aria-busy={scopedLibrary.loading || moreLoading}>
            {scopedLibrary.loading && !scopedLibrary.assets.length ? <div className="flex flex-col gap-3 p-2" role="status" aria-label="正在加载素材库">{[0, 1, 2].map((item) => <div key={item} className="flex items-start gap-3"><Skeleton className="size-12 shrink-0" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-3/5" /><Skeleton className="h-5 w-20" /></div></div>)}</div>
              : scopedLibrary.error && !scopedLibrary.assets.length ? <Alert variant="destructive"><AlertTitle>素材库暂时无法加载</AlertTitle><AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{scopedLibrary.error}<Button type="button" variant="outline" size="xs" onClick={() => setRefresh((value) => value + 1)}>重新加载</Button></AlertDescription></Alert>
                : scopedLibrary.assets.length ? <div className="flex flex-col gap-1">{scopedLibrary.assets.map((asset) => <LibraryMedia key={asset.id} asset={asset} busy={Boolean(busy[keyFor(asset.id)])} onReuse={onReuse} onSaved={() => setRefresh((value) => value + 1)} />)}{scopedLibrary.error ? <Alert variant="destructive"><AlertTitle>素材更新未完成</AlertTitle><AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{scopedLibrary.error}<Button type="button" variant="ghost" size="xs" onClick={() => setRefresh((value) => value + 1)}>重新加载</Button></AlertDescription></Alert> : null}</div>
                  : <Empty className="py-8"><EmptyHeader><EmptyMedia variant="icon"><Library /></EmptyMedia><EmptyTitle>{hasQuery ? '没有找到这些素材' : '素材库等着你的作品'}</EmptyTitle><EmptyDescription>{hasQuery ? '试试其它名称、目录或标签。' : '已保存的图片、视频和音频会保留在这里，可以复用到其它画布。'}</EmptyDescription></EmptyHeader>{hasQuery ? <EmptyContent><Button type="button" variant="outline" size="sm" onClick={resetFilters}>清除筛选</Button></EmptyContent> : null}</Empty>}
          </div>
          </div>
          <Separator />
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
            <span className="text-[11px] text-ink-muted">{scopedLibrary.loading ? '正在加载' : `${scopedLibrary.assets.length} 项素材`}</span>
            <div className="flex items-center gap-1">{scopedLibrary.nextCursor ? <Button type="button" variant="ghost" size="xs" disabled={moreLoading || scopedLibrary.loading} onClick={loadMore}>{moreLoading ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : null}{moreLoading ? '加载中' : '加载更多'}</Button> : null}<Tooltip content="刷新素材库"><Button type="button" variant="ghost" size="icon-xs" aria-label="刷新素材库" disabled={scopedLibrary.loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw /></Button></Tooltip></div>
          </div>
        </TabsContent>
      </Tabs>
    </CanvasUtilityPanel>{fileInput}
  </Panel>;
}

export default memo(AssetShelf);
