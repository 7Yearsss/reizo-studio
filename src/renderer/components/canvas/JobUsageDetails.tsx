import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CanvasJobStatus } from '../../../shared/canvasJobs';
import type { UsageRecord } from '../../../shared/usage';
import { listUsageRecords } from '../../api';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import UsageRecordDetails from '../usage/UsageRecordDetails';

export default function JobUsageDetails({ jobId, status }: { jobId: string; status: CanvasJobStatus }) {
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setError('');
    void listUsageRecords({ jobId, limit: 40 }).then((page) => { if (current) setRecords(page.records); })
      .catch((error) => { if (current) setError(error instanceof Error ? error.message : '用量详情未能读取'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [jobId, status, refresh]);
  return <div className="mt-3 flex flex-col gap-3 rounded-lg bg-paper p-3"><div className="flex items-center justify-between"><span className="text-[11px] font-medium text-ink">用量与费用</span><Button type="button" variant="ghost" size="icon-xs" aria-label="刷新此任务用量" title="刷新此任务用量" disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw /></Button></div>
    {error ? <Alert variant="destructive"><AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{error}<Button type="button" variant="ghost" size="xs" onClick={() => setRefresh((value) => value + 1)}>重新读取</Button></AlertDescription></Alert> : loading && !records.length ? <div role="status" aria-label="正在读取任务用量"><Skeleton className="h-16 w-full" /></div> : records.length ? records.map((record) => <UsageRecordDetails key={record.id} record={record} compact />) : <p className="text-xs leading-relaxed text-ink-muted">没有用量记录，费用未知，未与账单核对。已有任务历史不代表已记录计费用量。</p>}
  </div>;
}
