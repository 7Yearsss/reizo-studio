import { useMemo } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, Wand2, X } from 'lucide-react';
import type { SheetArtifactContent } from '../../../shared/sheetContent';
import { SHEET_CHECK_LABELS, checkSheet, type SheetCheckFinding, type SheetCheckKind, type SheetCheckSeverity } from '../../../shared/sheetChecks';
import { Button } from '../ui/button';

const SEVERITY_ICON: Record<SheetCheckSeverity, typeof Info> = { error: CircleAlert, warning: TriangleAlert, info: Info };
const SEVERITY_COLOR: Record<SheetCheckSeverity, string> = { error: 'text-danger', warning: 'text-amber-600 dark:text-amber-400', info: 'text-ink-muted' };
const SHOWN_PER_KIND = 20;

function fixText(finding: SheetCheckFinding): string | undefined {
  if (!finding.fix) return undefined;
  return 'formula' in finding.fix ? finding.fix.formula : String(finding.fix.value);
}

/** Instant, deterministic workbook audit: nothing is sent to the model until the user asks for the fixes. */
export default function SheetAuditPanel({ content, busy, onFocus, onFix, onClose }: {
  content: SheetArtifactContent;
  busy: boolean;
  onFocus(target: { sheetId: string; range: string }): void;
  onFix(): void;
  onClose(): void;
}) {
  const result = useMemo(() => checkSheet(content, { max: 1000 }), [content]);
  const groups = useMemo(() => {
    const byKind = new Map<SheetCheckKind, SheetCheckFinding[]>();
    for (const finding of result.findings) byKind.set(finding.kind, [...(byKind.get(finding.kind) ?? []), finding]);
    return [...byKind.entries()];
  }, [result]);
  const multiSheet = content.sheets.length > 1;
  const fixable = result.findings.filter((finding) => finding.fix && finding.severity !== 'info').length;

  return <aside aria-label="表格检查" className="flex w-80 shrink-0 flex-col border-l border-line bg-paper">
    <div className="flex items-center gap-2 border-b border-line px-3 py-2">
      <h3 className="mr-auto text-sm font-medium">检查结果</h3>
      <Button variant="ghost" size="icon-xs" aria-label="关闭检查" onClick={onClose}><X /></Button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {!result.total && <div className="flex flex-col items-center gap-1.5 p-6 text-center text-xs text-ink-muted">
        <CircleCheck className="size-5 text-success" />
        <p className="text-sm text-ink">没有发现问题</p>
        <p>已检查 {result.scanned.sheets} 张工作表、{result.scanned.cells} 个单元格、{result.scanned.formulas} 个公式</p>
      </div>}
      {groups.map(([kind, items]) => {
        const Icon = SEVERITY_ICON[items[0]!.severity];
        return <section key={kind} className="border-b border-line px-3 py-2">
          <h4 className={`mb-1 flex items-center gap-1.5 text-xs font-medium ${SEVERITY_COLOR[items[0]!.severity]}`}><Icon className="size-3.5" />{SHEET_CHECK_LABELS[kind]}<span className="tabular-nums text-ink-muted">{items.length}</span></h4>
          <ul className="flex flex-col">
            {items.slice(0, SHOWN_PER_KIND).map((finding) => <li key={`${finding.sheetId}:${finding.range}:${kind}`}>
              <button type="button" className="flex w-full flex-col gap-0.5 rounded px-1.5 py-1 text-left text-xs hover:bg-paper-raised" onClick={() => onFocus({ sheetId: finding.sheetId, range: finding.range.split(':')[0]! })}>
                <span className="font-mono">{multiSheet ? `${finding.sheet}!` : ''}{finding.range}</span>
                <span className="text-ink-muted">{finding.message}</span>
                {fixText(finding) !== undefined && <span className="truncate text-[11px] text-ink-muted" title={fixText(finding)}>建议：<span className="font-mono text-ink">{fixText(finding)}</span></span>}
              </button>
            </li>)}
          </ul>
          {items.length > SHOWN_PER_KIND && <p className="px-1.5 pt-1 text-[11px] text-ink-muted">另有 {items.length - SHOWN_PER_KIND} 处同类问题</p>}
        </section>;
      })}
    </div>
    {result.total > 0 && <div className="flex items-center gap-2 border-t border-line px-3 py-2">
      <span className="min-w-0 flex-1 text-[11px] text-ink-muted">{fixable ? `${fixable} 处有明确的修法，修改会先给你逐条审核` : '这些问题没有唯一的修法，需要你决定'}</span>
      <Button size="xs" disabled={busy || !fixable} onClick={onFix}><Wand2 data-icon="inline-start" />让 AI 修复</Button>
    </div>}
  </aside>;
}
