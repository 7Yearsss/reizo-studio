import { useEffect, useMemo, useRef, useState } from 'react';
import { ArchiveRestore, CheckCircle2, ChevronLeft, ChevronRight, FolderClosed, LoaderCircle, RefreshCw, ScanSearch, ShieldCheck } from 'lucide-react';
import { nanoid } from 'nanoid';
import type { CanvasMaintenanceFile, CanvasMaintenanceScan, CanvasQuarantineBatch } from '../../../shared/canvasMaintenance';
import { listCanvasQuarantine, quarantineCanvasFiles, restoreCanvasFiles, scanCanvasStorage } from '../../api';
import { cn } from '../../lib/cn';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../../components/ui/empty';
import { Field, FieldLabel } from '../../components/ui/field';
import { Separator } from '../../components/ui/separator';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';

type FileStatus = CanvasMaintenanceFile['status'];
const FILE_GROUPS: Array<{ status: FileStatus; label: string; description: string }> = [
  { status: 'protected', label: '登记保护', description: '登记素材或持久记录仍有引用' },
  { status: 'review', label: '需复核', description: '近期变更或无法确认引用' },
  { status: 'candidate', label: '可隔离', description: '可手动移入隔离区，之后可恢复' },
];
const PAGE_SIZE = 40;
const MAX_SELECTION = 100;
const quarantineLabels = { pending: '隔离待完成', quarantined: '已隔离', restored: '已恢复' };

function bytes(value?: number) {
  if (value === undefined) return '大小未知';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function dateLabel(value?: string) {
  if (!value) return '时间未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function errorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }

export default function StorageMaintenanceSection() {
  const [scan, setScan] = useState<CanvasMaintenanceScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [expired, setExpired] = useState(false);
  const [status, setStatus] = useState<FileStatus>('candidate');
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState(new Set<string>());
  const [batches, setBatches] = useState<CanvasQuarantineBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [batchError, setBatchError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const batchSequence = useRef(0);
  const attempt = useRef<{ token: string; paths: string[]; id: string } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);

  const readBatches = async () => {
    const sequence = ++batchSequence.current;
    setLoadingBatches(true);
    try {
      const response = await listCanvasQuarantine();
      if (mounted.current && sequence === batchSequence.current) { setBatches(response); setBatchError(''); }
    } catch (error) {
      if (mounted.current && sequence === batchSequence.current) setBatchError(errorMessage(error, '隔离记录读取失败'));
    } finally { if (mounted.current && sequence === batchSequence.current) setLoadingBatches(false); }
  };

  useEffect(() => { mounted.current = true; void readBatches(); return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!scan) { setExpired(false); return; }
    const lifetime = Date.parse(scan.expiresAt) - Date.now();
    setExpired(!Number.isFinite(lifetime) || lifetime <= 0);
    if (!Number.isFinite(lifetime) || lifetime <= 0) return;
    const timer = setTimeout(() => setExpired(true), Math.min(lifetime, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [scan]);
  useEffect(() => { setPageIndex(0); }, [status, scan?.token]);

  const summaries = useMemo(() => FILE_GROUPS.map((group) => {
    const files = scan?.files.filter((file) => file.status === group.status) ?? [];
    return { ...group, count: files.length, byteSize: files.reduce((total, file) => total + (file.byteSize ?? 0), 0), unknownSize: files.some((file) => file.byteSize === undefined) };
  }), [scan]);
  const filtered = useMemo(() => scan?.files.filter((file) => file.status === status) ?? [], [scan, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const selectedBytes = scan?.files.reduce((total, file) => total + (selected.has(file.path) ? file.byteSize ?? 0 : 0), 0) ?? 0;
  const allPageSelected = visible.length > 0 && visible.every((file) => selected.has(file.path));
  const selectable = Boolean(scan?.referencesComplete && !expired && !busy && !scanning);

  const resetAttempt = () => { attempt.current = null; setRetrying(false); };
  const changeSelection = (path: string, checked: boolean) => {
    if (!selectable) return;
    setSelected((current) => {
      const next = new Set(current);
      if (checked && next.size < MAX_SELECTION) next.add(path); else if (!checked) next.delete(path);
      return next;
    });
    resetAttempt(); setError('');
  };

  const runScan = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setScanning(true); setError(''); setNotice('');
    resetAttempt(); setSelected(new Set());
    try {
      const response = await scanCanvasStorage();
      if (mounted.current) { setScan(response); setExpired(Date.parse(response.expiresAt) <= Date.now()); }
    } catch (error) { if (mounted.current) setError(errorMessage(error, '扫描未完成，请重试')); }
    finally { inFlight.current = false; if (mounted.current) setScanning(false); }
  };

  const recordBatch = (batch: CanvasQuarantineBatch) => {
    ++batchSequence.current;
    setLoadingBatches(false); setBatchError('');
    setBatches((current) => [batch, ...current.filter((known) => known.id !== batch.id)]);
  };

  const quarantine = async () => {
    if (inFlight.current || !scan?.referencesComplete || !selected.size) return;
    const paths = [...selected].sort();
    const previous = attempt.current;
    if (!previous && Date.parse(scan.expiresAt) <= Date.now()) { setExpired(true); setError('扫描结果已过期，请重新扫描'); return; }
    const request = previous ?? { token: scan.token, paths, id: nanoid() };
    attempt.current = request;
    inFlight.current = true; setBusy('quarantine'); setError(''); setNotice('');
    try {
      const batch = await quarantineCanvasFiles(request.token, request.paths, request.id);
      if (mounted.current) {
        recordBatch(batch); setScan(null); setSelected(new Set()); resetAttempt();
        const count = batch.files.filter((file) => file.status === 'quarantined').length;
        const pending = batch.files.filter((file) => file.status === 'pending').length;
        setNotice(pending ? `已隔离 ${count} 个文件，另有 ${pending} 个待完成。可在下方恢复这批文件。` : `已隔离 ${count} 个文件。可在下方恢复；重新扫描可更新存储概览。`);
        requestAnimationFrame(() => noticeRef.current?.focus());
      }
    } catch (error) {
      if (mounted.current) { setRetrying(true); setError(errorMessage(error, '隔离结果尚未确认，请保留当前选择并重试')); void readBatches(); }
    } finally { inFlight.current = false; if (mounted.current) setBusy(''); }
  };

  const restore = async (batch: CanvasQuarantineBatch, paths: string[]) => {
    if (inFlight.current || !paths.length) return;
    inFlight.current = true; setBusy(`restore:${batch.id}`); setError(''); setNotice('');
    try {
      const response = await restoreCanvasFiles(batch.id, paths);
      if (mounted.current) {
        recordBatch(response); setScan(null); setSelected(new Set()); resetAttempt();
        const count = response.files.filter((file) => paths.includes(file.path) && file.status === 'restored').length;
        setNotice(`已恢复 ${count} 个文件。文件状态已更新，重新扫描可更新存储概览。`);
        requestAnimationFrame(() => noticeRef.current?.focus());
      }
    } catch (error) { if (mounted.current) { setError(errorMessage(error, '恢复未完成，请查看文件状态后重试')); void readBatches(); } }
    finally { inFlight.current = false; if (mounted.current) setBusy(''); }
  };

  return <div className="flex max-w-4xl flex-col gap-7">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-xl font-semibold tracking-tight">存储</h1><p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">查看画布素材的引用情况，将确认可隔离的文件移入隔离区，并随时恢复。</p></div>
      <Button type="button" variant="outline" size="sm" disabled={scanning || Boolean(busy)} onClick={() => void runScan()}>{scanning ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <ScanSearch data-icon="inline-start" />}{scanning ? '正在扫描' : scan ? '重新扫描' : '扫描存储'}</Button>
    </header>
    {error ? <Alert variant="destructive"><AlertTitle>存储操作未完成</AlertTitle><AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{error}</AlertDescription></Alert> : null}
    {notice ? <Alert ref={noticeRef} role="status" tabIndex={-1}><CheckCircle2 /><AlertTitle>存储已更新</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert> : null}
    {scanning && !scan ? <div className="grid grid-cols-3 gap-5" role="status" aria-label="正在扫描存储">{[0, 1, 2].map((key) => <div key={key} className="flex flex-col gap-3"><Skeleton className="h-4 w-20" /><Skeleton className="h-8 w-16" /><Skeleton className="h-3 w-full" /></div>)}</div> : scan ? <section aria-label="扫描概览" className="flex flex-col gap-5" aria-busy={scanning}>
      <dl className="grid grid-cols-1 gap-5 sm:grid-cols-3">{summaries.map((group) => <div key={group.status}><dt className="text-sm font-medium text-ink">{group.label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">{group.count}<span className="ml-2 text-xs font-normal text-ink-muted">个文件</span></dd><dd className="mt-1 text-xs text-ink-muted">{group.unknownSize ? '至少 ' : ''}{bytes(group.byteSize)}</dd><dd className="mt-2 text-xs leading-relaxed text-ink-muted">{group.description}</dd></div>)}</dl>
      <p className="text-xs leading-relaxed text-ink-muted">本次扫描只读取文件和引用记录。可隔离文件至少 {scan.minimumAgeHours} 小时未变更；执行隔离前会再次核对。</p>
      {!scan.referencesComplete || scan.warnings.length ? <Alert><ShieldCheck /><AlertTitle>部分文件需要人工复核</AlertTitle><AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{scan.warnings.map((warning, index) => <p key={`${index}:${warning}`}>{warning}</p>)}{!scan.referencesComplete ? <p>引用扫描未完成，当前结果不能用于隔离。</p> : null}</AlertDescription></Alert> : null}
      {expired ? <p role="status" className="text-xs text-danger">扫描结果已过期，请重新扫描。尚未确认的隔离请求仍可重试。</p> : <p className="text-xs text-ink-muted">扫描结果有效至 {dateLabel(scan.expiresAt)}</p>}
      <Tabs value={status} onValueChange={(value) => setStatus(value as FileStatus)}>
        <TabsList variant="line" className="w-full sm:w-fit">{FILE_GROUPS.map((group) => <TabsTrigger key={group.status} value={group.status}>{group.label}</TabsTrigger>)}</TabsList>
        {FILE_GROUPS.map((group) => <TabsContent key={group.status} value={group.status}>
          {status === 'candidate' && filtered.length ? <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-ink-muted">已选 {selected.size} 个，{bytes(selectedBytes)}；每次最多 {MAX_SELECTION} 个</span>
            <div className="flex gap-1"><Button type="button" variant="ghost" size="xs" disabled={!selectable || !allPageSelected && selected.size + visible.filter((file) => !selected.has(file.path)).length > MAX_SELECTION} onClick={() => { setSelected((current) => { const next = new Set(current); visible.forEach((file) => { if (allPageSelected) next.delete(file.path); else next.add(file.path); }); return next; }); resetAttempt(); setError(''); }}>{allPageSelected ? '取消本页选择' : '选择本页'}</Button><Button type="button" variant="ghost" size="xs" disabled={!selected.size || Boolean(busy) || scanning} onClick={() => { setSelected(new Set()); resetAttempt(); setError(''); }}>清除选择</Button></div>
          </div> : null}
          {visible.length ? <ul className="flex max-h-[420px] flex-col overflow-y-auto rounded-lg border border-line px-3">
            {visible.map((file) => <li key={file.path} className="pt-3">
              <Field orientation="horizontal" data-disabled={status === 'candidate' && !selectable}>
                {status === 'candidate' ? <Checkbox id={`storage-${file.path}`} checked={selected.has(file.path)} disabled={!selectable || selected.size >= MAX_SELECTION && !selected.has(file.path)} onCheckedChange={(checked) => changeSelection(file.path, checked === true)} aria-label={`选择隔离 ${file.path}`} /> : null}
                <div className="min-w-0 flex-1"><FieldLabel htmlFor={status === 'candidate' ? `storage-${file.path}` : undefined} className="select-text [overflow-wrap:anywhere]">{file.path}</FieldLabel><p className="mt-1 text-xs text-ink-muted">{bytes(file.byteSize)}，修改于 {dateLabel(file.modifiedAt)}</p>{file.reasons.length ? <p className="mt-1 text-xs leading-relaxed text-ink-muted [overflow-wrap:anywhere]">{file.reasons.join('；')}</p> : null}</div>
              </Field><Separator className="mt-3" />
            </li>)}
          </ul> : <Empty className="py-7"><EmptyHeader><EmptyTitle>{status === 'candidate' ? '没有可隔离文件' : status === 'protected' ? '没有登记保护的文件' : '没有需要复核的文件'}</EmptyTitle><EmptyDescription>{status === 'candidate' ? '本次扫描没有找到符合隔离条件的文件。' : '可以查看其它分类的扫描结果。'}</EmptyDescription></EmptyHeader></Empty>}
        </TabsContent>)}
      </Tabs>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-ink-muted"><span>{filtered.length} 个文件{pageCount > 1 ? `，第 ${currentPage + 1} / ${pageCount} 页` : ''}</span>{pageCount > 1 ? <><Button type="button" variant="ghost" size="icon-xs" aria-label="上一页文件" disabled={!currentPage || Boolean(busy)} onClick={() => setPageIndex((value) => value - 1)}><ChevronLeft /></Button><Button type="button" variant="ghost" size="icon-xs" aria-label="下一页文件" disabled={currentPage >= pageCount - 1 || Boolean(busy)} onClick={() => setPageIndex((value) => value + 1)}><ChevronRight /></Button></> : null}</div>
        <Button type="button" size="sm" disabled={!selected.size || !scan.referencesComplete || scanning || Boolean(busy) || expired && !retrying} onClick={() => void quarantine()}>{busy === 'quarantine' ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <FolderClosed data-icon="inline-start" />}{busy === 'quarantine' ? '正在隔离' : retrying ? '重试隔离所选文件' : `隔离所选文件${selected.size ? ` (${selected.size})` : ''}`}</Button>
      </div>
    </section> : !scanning ? <Empty className="items-start px-0 text-left"><EmptyHeader className="items-start text-left"><EmptyTitle>先查看文件与引用</EmptyTitle><EmptyDescription>点击“扫描存储”获取登记保护、需复核和可隔离清单。扫描不会移动文件。</EmptyDescription></EmptyHeader></Empty> : null}
    <Separator />
    <section aria-label="隔离记录" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">隔离记录</h2><p className="mt-1 text-xs text-ink-muted">恢复后，文件回到原画布目录。</p></div><Button type="button" variant="ghost" size="icon-xs" aria-label="刷新隔离记录" title="刷新隔离记录" disabled={loadingBatches || Boolean(busy) || scanning} onClick={() => void readBatches()}>{loadingBatches ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}</Button></div>
      {batchError ? <Alert variant="destructive"><AlertTitle>隔离记录未能加载</AlertTitle><AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{batchError}<Button type="button" variant="ghost" size="xs" disabled={loadingBatches} onClick={() => void readBatches()}>重新加载</Button></AlertDescription></Alert> : null}
      {loadingBatches && !batches.length ? <div role="status" aria-label="正在加载隔离记录"><Skeleton className="h-20 w-full" /></div> : batches.length ? <div className="flex flex-col gap-3">{batches.map((batch) => {
        const recoverable = batch.files.filter((file) => file.status !== 'restored');
        return <article key={batch.id} className="rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-medium">{dateLabel(batch.createdAt)}</h3><p className="mt-1 text-xs text-ink-muted">{batch.reviewReason ? '隔离记录需复核' : <>{batch.files.length} 个文件，{bytes(batch.files.reduce((total, file) => total + file.byteSize, 0))}{recoverable.length ? `；${recoverable.length} 个可恢复` : '；已全部恢复'}</>}</p></div>{recoverable.length ? <Button type="button" variant="outline" size="xs" disabled={Boolean(busy) || scanning} onClick={() => void restore(batch, recoverable.map((file) => file.path))}>{busy === `restore:${batch.id}` ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <ArchiveRestore data-icon="inline-start" />}{busy === `restore:${batch.id}` ? '正在恢复' : '恢复全部'}</Button> : null}</div>
          {batch.reviewReason ? <Alert className="mt-3"><AlertTitle>文件已保留</AlertTitle><AlertDescription className="min-w-0 [overflow-wrap:anywhere]"><p>{batch.reviewReason}</p><p className="select-text">记录：{batch.id}</p></AlertDescription></Alert> : null}
          {batch.files.length ? <details className="mt-3"><summary className="w-fit cursor-pointer rounded text-xs text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring">查看文件清单</summary><ul className="mt-2 flex flex-col gap-3">{batch.files.map((file) => <li key={file.path} className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><p className="select-text text-xs text-ink [overflow-wrap:anywhere]">{file.path}</p><p className={cn('mt-1 text-xs', file.status === 'restored' ? 'text-success' : 'text-ink-muted')}>{quarantineLabels[file.status]}，{bytes(file.byteSize)}</p></div>{file.status !== 'restored' ? <Button type="button" variant="ghost" size="xs" disabled={Boolean(busy) || scanning} onClick={() => void restore(batch, [file.path])}><ArchiveRestore data-icon="inline-start" />恢复</Button> : null}</li>)}</ul></details> : null}
        </article>;
      })}</div> : !batchError ? <Empty className="py-6"><EmptyHeader><EmptyTitle>暂无隔离记录</EmptyTitle><EmptyDescription>手动隔离的文件会显示在这里，并可恢复到原位置。</EmptyDescription></EmptyHeader></Empty> : null}
    </section>
  </div>;
}
