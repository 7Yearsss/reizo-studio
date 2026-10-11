import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { ArtifactReview, ArtifactReviewChange } from '../../../shared/artifactReview';
import { parseSheetContent, type SheetArtifactContent } from '../../../shared/sheetContent';
import {
  SHEET_CHANGE_COLORS,
  SHEET_CHANGE_LABELS,
  applySheetReviewOperations,
  diffSheetContent,
  formatSheetCell,
  formatSheetDiffCounts,
  isDestructiveSheetChange,
  sheetReviewTarget,
  sheetTargetRange,
  type SheetCellChange,
  type SheetCellChangeKind,
  type SheetDiff,
  type SheetReviewOperation,
} from '../../../shared/sheetReview';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';

const SHOWN_CELLS = 60;

export interface SheetSelectedCell { sheetId: string; row: number; col: number }
interface ChangeView { change: ArtifactReviewChange; diff: SheetDiff | null; destructive: boolean; focus?: { sheetId: string; range: string } }

function describe(base: SheetArtifactContent | null, change: ArtifactReviewChange): ChangeView {
  const operation = change.operation as SheetReviewOperation;
  if (!base) return { change, diff: null, destructive: true };
  try {
    const diff = diffSheetContent(base, applySheetReviewOperations(base, [operation]));
    const sheet = diff.sheets[0];
    const target = operation.op === 'addSheet' ? undefined : sheetReviewTarget(base, operation);
    const range = (target && sheetTargetRange(target)) ?? sheet?.cells[0]?.a1 ?? 'A1';
    return { change, diff, destructive: isDestructiveSheetChange(operation, diff), focus: sheet ? { sheetId: sheet.sheetId, range } : undefined };
  } catch {
    return { change, diff: null, destructive: true };
  }
}

export function Swatch({ kind }: { kind: SheetCellChangeKind }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-sm border border-line" style={{ background: SHEET_CHANGE_COLORS[kind] }} />;
}

function CellTable({ diff }: { diff: SheetDiff }) {
  const rows = diff.sheets.flatMap((sheet) => sheet.cells.map((cell) => ({ sheet: sheet.name, cell })));
  const multiSheet = diff.sheets.length > 1;
  return <div className="mt-1.5 overflow-hidden rounded border border-line">
    <table className="w-full table-fixed text-[11px]">
      <thead className="bg-paper-raised text-ink-muted"><tr><th className="w-16 px-1.5 py-1 text-left font-medium">单元格</th><th className="px-1.5 py-1 text-left font-medium">原值</th><th className="px-1.5 py-1 text-left font-medium">新值</th></tr></thead>
      <tbody>{rows.slice(0, SHOWN_CELLS).map(({ sheet, cell }) => <tr key={`${sheet}:${cell.a1}`} className="border-t border-line align-top">
        <td className="px-1.5 py-1 font-mono"><span className="flex items-center gap-1"><Swatch kind={cell.kind} />{multiSheet ? `${sheet}!` : ''}{cell.a1}</span></td>
        <td className="truncate px-1.5 py-1 text-ink-muted line-through decoration-ink-muted/50" title={formatSheetCell(cell.before)}>{formatSheetCell(cell.before)}</td>
        <td className="truncate px-1.5 py-1" title={formatSheetCell(cell.after)}>{formatSheetCell(cell.after)}</td>
      </tr>)}</tbody>
    </table>
    {rows.length > SHOWN_CELLS && <p className="border-t border-line px-1.5 py-1 text-[11px] text-ink-muted">另有 {rows.length - SHOWN_CELLS} 处，请在表格中查看高亮</p>}
  </div>;
}

function SelectedCell({ change }: { change: SheetCellChange }) {
  return <div className="rounded border border-line bg-paper-raised px-2 py-1.5 text-xs">
    <p className="flex items-center gap-1.5 font-medium"><Swatch kind={change.kind} />{change.a1} · {SHEET_CHANGE_LABELS[change.kind]}</p>
    <p className="mt-1 break-all text-ink-muted">原：{formatSheetCell(change.before) || '（空）'}</p>
    <p className="break-all">新：{formatSheetCell(change.after) || '（空）'}</p>
  </div>;
}

export default function SheetReview({ reviews, totalDiff, busy, previewing, selected, onTogglePreview, onFocus, decide }: {
  reviews: ArtifactReview[];
  totalDiff: SheetDiff | null;
  busy: boolean;
  previewing: boolean;
  selected?: SheetSelectedCell;
  onTogglePreview(): void;
  onFocus(target: { sheetId: string; range: string }): void;
  decide(review: ArtifactReview, ids: string[], decision: 'accept' | 'reject'): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const pending = reviews.filter((review) => review.changes.some((change) => change.status === 'pending'));
  const views = useMemo(() => new Map(pending.map((review) => {
    const base = parseSheetContent(review.baseContent);
    return [review.id, review.changes.filter((change) => change.status === 'pending').map((change) => describe(base, change))] as const;
  })), [pending.map((review) => `${review.id}:${review.reviewVersion}`).join(',')]);
  const selectedChange = selected && totalDiff?.sheets.find((sheet) => sheet.sheetId === selected.sheetId)?.cells.find((cell) => cell.row === selected.row && cell.col === selected.col);
  const decided = reviews.flatMap((review) => review.changes.filter((change) => change.status !== 'pending'));

  return <aside aria-label="表格修改建议" className="flex w-80 shrink-0 flex-col border-l border-line bg-paper">
    <div className="flex flex-col gap-2 border-b border-line px-3 py-2">
      <div className="flex items-center gap-2"><h3 className="mr-auto text-sm font-medium">AI 修改建议</h3><Button size="xs" variant="ghost" onClick={onTogglePreview}>{previewing ? '查看原表' : '预览修改'}</Button></div>
      <p className="text-xs text-ink-muted">接受后才会写入表格{previewing ? '；点击高亮单元格查看前后对比' : ''}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">{(Object.keys(SHEET_CHANGE_LABELS) as SheetCellChangeKind[]).map((kind) => <span key={kind} className="flex items-center gap-1"><Swatch kind={kind} />{SHEET_CHANGE_LABELS[kind]}{totalDiff ? ` ${totalDiff.counts[kind]}` : ''}</span>)}</div>
      {selectedChange && previewing && <SelectedCell change={selectedChange} />}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {!pending.length && <p className="p-3 text-xs text-ink-muted">暂无待审核修改。</p>}
      {pending.map((review) => {
        const items = views.get(review.id) ?? [];
        const safe = items.filter((item) => !item.destructive).map((item) => item.change.id);
        const all = items.map((item) => item.change.id);
        return <div key={review.id} className="flex flex-col gap-2 border-b border-line p-3">
          {review.stale && <Alert><AlertDescription>表格已有新版本，这批建议无法接受；请在对话中让 Agent 基于最新内容重新提出。</AlertDescription></Alert>}
          <div className="flex items-center gap-2">
            <span className="mr-auto text-xs text-ink-muted">{all.length} 项 · 基于 v{review.baseVersion}</span>
            <Button size="xs" variant="outline" disabled={busy} onClick={() => decide(review, all, 'reject')}>全部拒绝</Button>
            <Button size="xs" disabled={busy || review.stale || !safe.length} onClick={() => decide(review, safe, 'accept')}>{safe.length === all.length ? '全部接受' : `接受其余 ${safe.length} 项`}</Button>
          </div>
          {safe.length < all.length && <p className="flex items-start gap-1.5 text-[11px] text-ink-muted"><AlertTriangle className="mt-px size-3 shrink-0 text-danger" />清空、删除或覆盖公式的修改需逐项确认</p>}
          {items.map(({ change, diff, destructive, focus }) => <div key={change.id} className="rounded border border-line">
            <button type="button" className="flex w-full items-start gap-1.5 px-2 py-1.5 text-left hover:bg-paper-raised" aria-expanded={open === change.id} onClick={() => { setOpen(open === change.id ? null : change.id); if (focus) onFocus(focus); }}>
              <ChevronRight className={`mt-0.5 size-3 shrink-0 transition-transform ${open === change.id ? 'rotate-90' : ''}`} />
              <span className="min-w-0 flex-1">
                <span className="block break-all text-xs font-medium">{change.label.replace(/（[^（]*）$/, '')}</span>
                <span className="block text-[11px] text-ink-muted">{diff ? formatSheetDiffCounts(diff) : '无法预览，该项可能已失效'}</span>
              </span>
              {destructive && <span className="shrink-0 rounded bg-danger/10 px-1 text-[11px] text-danger">需确认</span>}
            </button>
            {open === change.id && diff && <div className="px-2 pb-2"><CellTable diff={diff} /></div>}
            <div className="flex justify-end gap-2 border-t border-line px-2 py-1.5">
              <Button size="xs" variant="outline" disabled={busy} onClick={() => decide(review, [change.id], 'reject')}>拒绝</Button>
              <Button size="xs" variant={destructive ? 'destructive' : 'default'} disabled={busy || review.stale || !diff} onClick={() => decide(review, [change.id], 'accept')}>接受</Button>
            </div>
          </div>)}
        </div>;
      })}
      {decided.length > 0 && <details className="p-3"><summary className="cursor-pointer text-xs text-ink-muted">审核记录</summary>{decided.map((change) => <p key={change.id} className="mt-2 break-all text-xs">{change.label} · {change.status === 'accepted' ? `已接受 · v${change.acceptedVersion}` : '已拒绝'}</p>)}</details>}
    </div>
  </aside>;
}
