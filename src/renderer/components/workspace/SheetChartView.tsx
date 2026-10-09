import { useEffect, useRef, useState } from 'react';
import { BarChart3, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { SheetArtifactContent } from '../../../shared/sheetContent';
import { parseA1Range } from '../../../shared/sheetContent';
import {
  CHART_PALETTE,
  SHEET_CHART_TYPE_LABELS,
  describeChartSource,
  sheetChartData,
  type SheetChart,
  type SheetChartChange,
  type SheetChartData,
  type SheetChartType,
} from '../../../shared/sheetChart';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

type ChartModule = typeof import('chart.js/auto');
let chartModule: Promise<ChartModule> | null = null;
const loadChart = () => (chartModule ??= import('chart.js/auto'));

const INK = { light: { text: '#55554f', grid: '#e7e7e3', surface: '#ffffff' }, dark: { text: '#c4c4bd', grid: '#34342f', surface: '#1a1a19' } };

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

/** Chart.js config for the in-app view, following the shared mark specs: thin rounded bars, 2px lines, 8px markers, recessive grid. */
export function sheetChartConfig(type: SheetChartType, data: SheetChartData, mode: 'light' | 'dark') {
  const palette = CHART_PALETTE[mode];
  const ink = INK[mode];
  const pie = type === 'pie';
  const horizontal = type === 'bar';
  const stacked = type === 'stackedColumn';
  const datasets = data.series.map((series, i) => {
    const color = palette[i % palette.length]!;
    if (pie) return { label: series.name, data: series.values, backgroundColor: data.categories.map((_, j) => palette[j % palette.length]!), borderColor: ink.surface, borderWidth: 2 };
    if (type === 'line') return { label: series.name, data: series.values, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0, spanGaps: true };
    return { label: series.name, data: series.values, backgroundColor: color, borderColor: ink.surface, borderWidth: stacked ? { top: 2 } : 0, borderRadius: 4, borderSkipped: 'start' as const, maxBarThickness: 36, categoryPercentage: 0.7, barPercentage: 0.9 };
  });
  const axis = { ticks: { color: ink.text, font: { size: 11 } }, grid: { color: ink.grid, drawTicks: false }, border: { display: false } };
  return {
    type: pie ? 'pie' as const : type === 'line' ? 'line' as const : 'bar' as const,
    data: { labels: data.categories, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: horizontal ? 'y' as const : 'x' as const,
      interaction: pie ? undefined : { mode: 'index' as const, intersect: false },
      plugins: {
        legend: { display: pie || data.series.length > 1, position: 'bottom' as const, labels: { color: ink.text, boxWidth: 10, boxHeight: 10, font: { size: 11 } } },
        tooltip: { enabled: true },
      },
      scales: pie ? undefined : {
        x: { ...axis, stacked, grid: { ...axis.grid, display: horizontal } },
        y: { ...axis, stacked, beginAtZero: true, grid: { ...axis.grid, display: !horizontal } },
      },
    },
  };
}

function ChartCanvas({ type, data }: { type: SheetChartType; data: SheetChartData }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const instance = useRef<{ destroy(): void } | null>(null);
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const key = JSON.stringify([type, data, dark]);
  useEffect(() => {
    let cancelled = false;
    void loadChart().then(({ Chart }) => {
      if (cancelled || !ref.current) return;
      instance.current?.destroy();
      instance.current = new Chart(ref.current, sheetChartConfig(type, data, dark ? 'dark' : 'light') as never);
    }).catch((): void => undefined);
    return () => { cancelled = true; };
  }, [key]);
  useEffect(() => () => { instance.current?.destroy(); instance.current = null; }, []);
  return <canvas ref={ref} role="img" aria-label={`${SHEET_CHART_TYPE_LABELS[type]}：${data.series.map((s) => s.name).join('、')}`} />;
}

function DataTable({ data }: { data: SheetChartData }) {
  return <table className="w-full text-[11px]"><thead><tr><th className="text-left font-medium text-ink-muted">分类</th>{data.series.map((s) => <th key={s.name} className="text-right font-medium text-ink-muted">{s.name}</th>)}</tr></thead>
    <tbody>{data.categories.map((c, i) => <tr key={`${c}:${i}`} className="border-t border-line"><td>{c}</td>{data.series.map((s) => <td key={s.name} className="text-right tabular-nums">{s.values[i] ?? ''}</td>)}</tr>)}</tbody></table>;
}

const STATUS_LABELS: Record<SheetChartChange['status'], string> = { added: '新增', changed: '修改', removed: '将删除' };

export default function SheetChartDock({ content, charts, statuses, busy, selection, onChangeType, onDelete, onCreateFromSelection }: {
  content: SheetArtifactContent;
  charts: SheetChart[];
  /** Review preview: per-chart change status. */
  statuses?: Record<string, SheetChartChange['status']>;
  busy?: boolean;
  selection?: { sheetId?: string; range?: string };
  onChangeType?(chart: SheetChart, type: SheetChartType): void;
  onDelete?(chart: SheetChart): void;
  onCreateFromSelection?(): void;
}) {
  const [open, setOpen] = useState(true);
  const [tableFor, setTableFor] = useState<string | null>(null);
  const range = selection?.range ? parseA1Range(selection.range) : null;
  const canCreate = Boolean(onCreateFromSelection && range && range.end.row > range.start.row && range.end.col > range.start.col);
  if (!charts.length && !canCreate) return null;
  return <section aria-label="图表" className="shrink-0 border-t border-line bg-paper">
    <div className="flex items-center gap-2 px-3 py-1">
      <button type="button" className="flex items-center gap-1 text-xs font-medium" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}<BarChart3 className="size-3.5 text-accent" />图表{charts.length ? ` (${charts.length})` : ''}</button>
      <span className="mr-auto" />
      {canCreate && <Button size="xs" variant="ghost" disabled={busy} title="首行作为系列名、首列作为分类" onClick={onCreateFromSelection}>用选区 {selection?.range} 生成图表</Button>}
    </div>
    {open && charts.length > 0 && <div className="flex gap-3 overflow-x-auto px-3 pb-3">
      {charts.map((chart) => {
        let data: SheetChartData | null = null; let error = '';
        try { data = sheetChartData(content, chart); } catch (cause) { error = cause instanceof Error ? cause.message : '无法读取图表数据'; }
        const status = statuses?.[chart.id];
        const empty = data && data.series.every((s) => s.values.every((v) => v === null));
        return <figure key={chart.id} className={`flex w-[380px] shrink-0 flex-col gap-1 rounded border p-2 ${status ? 'border-accent' : 'border-line'} ${status === 'removed' ? 'opacity-60' : ''}`}>
          <figcaption className="flex items-center gap-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate font-medium" title={`${chart.name} · ${describeChartSource(content, chart)}`}>{chart.name}</span>
            {status && <span className="rounded bg-accent/10 px-1 text-[10px] text-accent">{STATUS_LABELS[status]}</span>}
            {onChangeType && !status && <Select value={chart.type} disabled={busy} onValueChange={(type) => onChangeType(chart, type as SheetChartType)}>
              <SelectTrigger size="sm" className="h-6 text-xs" aria-label={`${chart.name} 图表类型`}><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{(Object.keys(SHEET_CHART_TYPE_LABELS) as SheetChartType[]).map((type) => <SelectItem key={type} value={type}>{SHEET_CHART_TYPE_LABELS[type]}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>}
            {data && <Button size="xs" variant="ghost" onClick={() => setTableFor(tableFor === chart.id ? null : chart.id)}>{tableFor === chart.id ? '图' : '表'}</Button>}
            {onDelete && !status && <Button size="icon-sm" variant="ghost" aria-label={`删除图表 ${chart.name}`} disabled={busy} onClick={() => onDelete(chart)}><Trash2 /></Button>}
          </figcaption>
          {error ? <p className="flex h-[220px] items-center justify-center text-xs text-danger">{error}</p>
            : tableFor === chart.id && data ? <div className="h-[220px] overflow-auto"><DataTable data={data} /></div>
            : data && <div className="relative h-[220px]">{empty && <p className="absolute inset-0 flex items-center justify-center text-xs text-ink-muted">公式计算完成后显示</p>}<ChartCanvas type={chart.type} data={data} /></div>}
        </figure>;
      })}
    </div>}
  </section>;
}
