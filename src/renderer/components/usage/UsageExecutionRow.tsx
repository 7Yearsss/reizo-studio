import { Fragment, useId, useState } from 'react';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import type { UsageRecord } from '../../../shared/usage';
import UsageRecordDetails, { categoryLabels, identity, isLocalUsage, money } from './UsageRecordDetails';
import { usageHighlights, usageStatus } from './usagePresentation';
import UsageBillForm from '../../pages/settings/UsageBillForm';
import { Button } from '../ui/button';
import { openChatTab } from '../../state/tabStore';
import { closeSettings, setMode } from '../../state/uiStore';

export default function UsageExecutionRow({ record, providerName, onBillSaved }: {
  record: UsageRecord; providerName: string; onBillSaved: (record: UsageRecord) => void;
}) {
  const [expanded, setExpanded] = useState(false); const detailsId = useId();
  const local = isLocalUsage(record); const status = usageStatus(record); const highlights = usageHighlights(record);
  const date = new Date(record.createdAt);
  const time = date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return <Fragment>
    <tr className="border-b border-line/70 align-top transition-colors hover:bg-paper-inset/30">
      <td className="max-w-[240px] py-4 pl-4 pr-3"><p className="truncate text-[13px] font-medium" title={record.model}>{identity(record.model)}</p>
        <p className="mt-1 truncate text-xs text-ink-muted" title={record.providerId}>{providerName} · {categoryLabels[record.category]}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-muted"><time dateTime={record.createdAt}>{time}</time>
          <span className={status.tone === 'danger' ? 'text-danger' : status.tone === 'positive' ? 'text-emerald-600 dark:text-emerald-400' : ''}>{status.label}</span></div>
      </td>
      <td className="px-3 py-4 text-xs tabular-nums"><div className="space-y-1.5">{highlights.length ? highlights.map(line => <p key={line}>{line}</p>) : <p className="text-ink-muted">{local ? '本地执行' : '供应商未返回用量'}</p>}</div></td>
      <td className="px-3 py-4 text-xs tabular-nums">
        {local ? <p className="text-ink-muted">本地执行</p> : record.bill ? <><p className="font-medium">{money(record.bill.amount, record.bill.currency)}</p><p className="mt-1 text-ink-muted">已录入账单</p>{record.estimate ? <p className="mt-1 text-ink-muted">估算 {money(record.estimate.amount, record.estimate.currency)}</p> : null}
          {record.reconciliation === 'amount_differs' || record.reconciliation === 'currency_mismatch' ? <p className="mt-1 text-amber-700 dark:text-amber-400">{record.reconciliation === 'currency_mismatch' ? '币种不同' : '与估算有差异'}</p> : null}</>
          : record.estimate ? <><p className="font-medium">{money(record.estimate.amount, record.estimate.currency)}</p><p className="mt-1 text-ink-muted">按价格估算</p></>
          : <><p className="text-ink-muted">未计价</p><p className="mt-1 max-w-40 text-[11px] leading-relaxed text-ink-muted">{record.estimateUnknownReason?.includes('价格') ? '缺少价格依据' : '缺少完整计费用量'}</p></>}
      </td>
      <td className="max-w-[170px] px-3 py-4 text-xs">
        {record.sessionId && record.sessionTitle ? <button type="button" title={`返回对话：${record.sessionTitle}`} className="group flex max-w-full items-start gap-1 rounded text-left text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring" onClick={() => {
          openChatTab(record.sessionId, record.sessionTitle); setMode('chat'); closeSettings();
        }}><span className="line-clamp-2 leading-relaxed">{record.sessionTitle}</span><ArrowUpRight className="mt-0.5 size-3 shrink-0 opacity-60" /></button>
          : <span className="text-ink-muted">{record.sessionId ? '原对话不可用' : '未关联对话'}</span>}
      </td>
      <td className="py-3 pl-1 pr-3"><Button type="button" variant="ghost" size="icon-sm" aria-label={`${expanded ? '收起' : '查看'}${identity(record.model)}的用量详情`} aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)}><ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} /></Button></td>
    </tr>
    {expanded ? <tr className="border-b border-line bg-paper-inset/25"><td colSpan={5} id={detailsId} className="p-4"><div className="grid gap-5 md:grid-cols-2"><UsageRecordDetails record={record} />
      <div className="flex flex-col gap-3">{record.jobError ? <p className="text-xs leading-relaxed text-danger [overflow-wrap:anywhere]">任务提示：{record.jobError}</p> : null}{!local ? <UsageBillForm record={record} onSaved={onBillSaved} /> : null}</div>
    </div></td></tr> : null}
  </Fragment>;
}
