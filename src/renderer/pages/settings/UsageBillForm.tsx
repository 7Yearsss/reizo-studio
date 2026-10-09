import { useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { nanoid } from 'nanoid';
import type { UsageBillInput, UsageRecord } from '../../../shared/usage';
import { recordUsageBill } from '../../api';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';

export default function UsageBillForm({ record, onSaved }: { record: UsageRecord; onSaved: (record: UsageRecord) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const submitting = useRef(false);
  if (record.bill) return null;
  if (!open) return <Button type="button" variant="outline" size="xs" className="self-start" onClick={() => setOpen(true)}>录入账单金额</Button>;
  return <form className="flex flex-col gap-3 rounded-lg border border-line p-3" aria-busy={busy} onSubmit={(event) => {
    event.preventDefault(); if (submitting.current) return;
    const values = new FormData(event.currentTarget);
    const input = { executionId: record.executionId, amount: Number(values.get('amount')), currency: String(values.get('currency')).trim().toUpperCase(), source: String(values.get('source')).trim(), reference: String(values.get('reference')).trim() };
    if (!Number.isFinite(input.amount) || input.amount < 0 || !/^[A-Z]{3}$/.test(input.currency)) { setError('请填写非负金额和三位币种代码。'); return; }
    const signature = JSON.stringify(input);
    if (!attempt.current || attempt.current.signature !== signature) attempt.current = { signature, id: nanoid() };
    const request: UsageBillInput = { ...input, id: attempt.current.id };
    submitting.current = true; setBusy(true); setError('');
    void recordUsageBill(request).then((updated) => { onSaved(updated); setOpen(false); attempt.current = null; })
      .catch((error) => setError(error instanceof Error ? error.message : '账单记录未能保存，保留输入后可重试'))
      .finally(() => { submitting.current = false; setBusy(false); });
  }}>
    <p className="text-xs leading-relaxed text-ink-muted">记录已有账单金额，不会向供应商发起扣款。每次执行只关联一份账单记录。</p>
    <FieldGroup className="gap-3"><div className="grid grid-cols-2 gap-3"><Field data-disabled={busy}><FieldLabel htmlFor={`bill-amount-${record.id}`}>账单金额</FieldLabel><Input id={`bill-amount-${record.id}`} name="amount" type="number" min="0" step="any" required disabled={busy} autoFocus /></Field><Field data-disabled={busy}><FieldLabel htmlFor={`bill-currency-${record.id}`}>币种</FieldLabel><Input id={`bill-currency-${record.id}`} name="currency" placeholder="USD / CNY" maxLength={3} defaultValue={record.estimate?.currency} required disabled={busy} /></Field></div><Field data-disabled={busy}><FieldLabel htmlFor={`bill-source-${record.id}`}>账单来源</FieldLabel><Input id={`bill-source-${record.id}`} name="source" placeholder="供应商发票或官方用量后台" maxLength={512} required disabled={busy} /></Field><Field data-disabled={busy}><FieldLabel htmlFor={`bill-reference-${record.id}`}>核对凭据</FieldLabel><Input id={`bill-reference-${record.id}`} name="reference" placeholder="账单号#扣费行或独立请求凭据" maxLength={512} required disabled={busy} /><FieldDescription>每次扣费行使用唯一凭据，不向供应商自动验证。</FieldDescription></Field></FieldGroup>
    {error ? <Alert variant="destructive"><AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{error}</AlertDescription></Alert> : null}
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => setOpen(false)}>取消</Button><Button type="submit" size="xs" disabled={busy}>{busy ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : null}{busy ? '正在保存' : '保存账单记录'}</Button></div>
  </form>;
}
