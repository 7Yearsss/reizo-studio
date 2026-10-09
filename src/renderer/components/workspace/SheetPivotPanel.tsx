import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { GripVertical, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import type { SheetArtifactContent } from '../../../shared/sheetContent';
import {
  MAX_PIVOT_ROW_FIELDS,
  MAX_PIVOT_VALUES,
  PIVOT_AGG_LABELS,
  applySheetPivot,
  describePivot,
  pivotFieldLabel,
  pivotSourceFields,
  removeSheetPivot,
  sheetPivots,
  suggestPivotSource,
  type PivotAggregate,
  type PivotSourceField,
  type SheetPivot,
  type SheetPivotFilter,
  type SheetPivotInput,
  type SheetPivotValue,
} from '../../../shared/sheetPivot';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import { Alert, AlertDescription } from '../ui/alert';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { SHEET_CHART_TYPE_LABELS, applySheetChart, removeChartsForPivot, sheetCharts, type SheetChartType } from '../../../shared/sheetChart';

type Zone = 'rows' | 'columns' | 'values' | 'filters';
type TargetMode = 'keep' | 'newSheet' | 'sheet';
interface Draft {
  id?: string;
  name: string;
  sourceSheetId: string;
  range: string;
  rows: string[];
  columns: string[];
  values: SheetPivotValue[];
  filters: SheetPivotFilter[];
  totals: boolean;
  targetMode: TargetMode;
  newSheet: string;
  targetSheetId: string;
  start: string;
}
const NEW = '__new__';
const ZONE_LABELS: Record<Zone, string> = { rows: '行', columns: '列', values: '值', filters: '筛选' };

function fromPivot(pivot: SheetPivot): Draft {
  return { id: pivot.id, name: pivot.name, sourceSheetId: pivot.source.sheetId, range: pivot.source.range, rows: pivot.rows, columns: pivot.columns, values: pivot.values, filters: pivot.filters, totals: pivot.totals, targetMode: 'keep', newSheet: '', targetSheetId: pivot.target.sheetId, start: pivot.target.start };
}
function blank(content: SheetArtifactContent, selection?: { sheetId?: string; range?: string }): Draft {
  const source = suggestPivotSource(content, selection?.sheetId, selection?.range);
  const sheetId = source?.sheetId ?? content.activeSheetId;
  const n = sheetPivots(content).length + 1;
  return { name: `透视表 ${n}`, sourceSheetId: sheetId, range: source?.range ?? '', rows: [], columns: [], values: [], filters: [], totals: true, targetMode: 'newSheet', newSheet: `透视表 ${n}`, targetSheetId: sheetId, start: 'A1' };
}
function toInput(draft: Draft): SheetPivotInput {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name,
    source: { sheet: draft.sourceSheetId, range: draft.range },
    rows: draft.rows, columns: draft.columns, values: draft.values, filters: draft.filters, totals: draft.totals,
    ...(draft.targetMode === 'newSheet' ? { target: { newSheet: draft.newSheet } } : draft.targetMode === 'sheet' ? { target: { sheet: draft.targetSheetId, start: draft.start } } : {}),
  };
}
function isNumeric(field?: PivotSourceField): boolean {
  return Boolean(field?.values.length && field.values.every((v) => v === '' || typeof v === 'number'));
}
function used(draft: Draft, name: string): boolean {
  return draft.rows.includes(name) || draft.columns.includes(name) || draft.values.some((v) => v.field === name) || draft.filters.some((f) => f.field === name);
}

/** Moves or adds a field into a zone, keeping each dimension field in at most one of rows/columns. */
function place(draft: Draft, field: string, zone: Zone, fields: PivotSourceField[]): Draft {
  const next = { ...draft, rows: draft.rows.filter((f) => f !== field), columns: draft.columns.filter((f) => f !== field) };
  if (zone === 'rows') next.rows = [...next.rows, field].slice(-MAX_PIVOT_ROW_FIELDS);
  if (zone === 'columns') next.columns = [field];
  if (zone === 'values' && draft.values.length < MAX_PIVOT_VALUES) next.values = [...draft.values, { field, agg: isNumeric(fields.find((f) => f.name === field)) ? 'sum' : 'count' }];
  if (zone === 'filters' && !draft.filters.some((f) => f.field === field)) {
    const values = fields.find((f) => f.name === field)?.values ?? [];
    next.filters = [...draft.filters, { field, values: values.map((v) => v === '' ? null : v) }];
  }
  return next;
}

function DropZone({ zone, children, onDrop }: { zone: Zone; children: ReactNode; onDrop(event: DragEvent): void }) {
  const [over, setOver] = useState(false);
  return <section aria-label={`${ZONE_LABELS[zone]}区域`} className={`flex min-h-12 flex-col gap-1 rounded border border-dashed p-1.5 ${over ? 'border-accent bg-accent/5' : 'border-line'}`}
    onDragOver={(event) => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(event) => { setOver(false); onDrop(event); }}>
    <h4 className="text-[11px] font-medium text-ink-muted">{ZONE_LABELS[zone]}</h4>
    {children}
  </section>;
}

function Chip({ field, zone, children, onRemove }: { field: string; zone: Zone; children?: ReactNode; onRemove(): void }) {
  return <div draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', JSON.stringify({ field, from: zone }))} className="flex flex-col gap-1 rounded border border-line bg-paper-raised px-1.5 py-1 text-xs">
    <div className="flex items-center gap-1"><GripVertical className="size-3 shrink-0 cursor-grab text-ink-muted" /><span className="min-w-0 flex-1 truncate">{field}</span><button type="button" aria-label={`移除 ${field}`} className="text-ink-muted hover:text-ink" onClick={onRemove}><X className="size-3" /></button></div>
    {children}
  </div>;
}

export default function SheetPivotPanel({ content, selection, busy, commit, onClose }: {
  content: SheetArtifactContent;
  selection?: { sheetId?: string; range?: string };
  busy: boolean;
  /** Saves `mutate(latest content)` as a new version; resolves false when it failed (the error is shown by the caller). */
  commit(mutate: (content: SheetArtifactContent) => SheetArtifactContent): Promise<boolean>;
  onClose(): void;
}) {
  const pivots = sheetPivots(content);
  const [selectedId, setSelectedId] = useState<string>(pivots[0]?.id ?? NEW);
  const [draft, setDraft] = useState<Draft>(() => pivots[0] ? fromPivot(pivots[0]) : blank(content, selection));
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedPivot = pivots.find((p) => p.id === selectedId);
  const pivotKey = selectedPivot ? JSON.stringify(selectedPivot) : '';
  useEffect(() => { if (selectedPivot) setDraft(fromPivot(selectedPivot)); }, [pivotKey]);

  const source = useMemo(() => {
    try { return { fields: draft.range ? pivotSourceFields(content, draft.sourceSheetId, draft.range) : [], error: draft.range ? '' : '请先选择包含表头的数据区域' }; }
    catch (cause) { return { fields: [] as PivotSourceField[], error: cause instanceof Error ? cause.message : '数据源无效' }; }
  }, [content, draft.sourceSheetId, draft.range]);
  const fields = source.fields;

  function pick(id: string) {
    setSelectedId(id); setError(''); setConfirmDelete(false);
    const pivot = pivots.find((p) => p.id === id);
    setDraft(pivot ? fromPivot(pivot) : blank(content, selection));
  }
  function drop(zone: Zone) {
    return (event: DragEvent) => {
      event.preventDefault();
      try {
        const data = JSON.parse(event.dataTransfer.getData('text/plain')) as { field: string; from?: Zone };
        setDraft((d) => {
          const base = data.from === 'values' ? { ...d, values: d.values.filter((v) => v.field !== data.field) } : data.from === 'filters' && zone !== 'filters' ? { ...d, filters: d.filters.filter((f) => f.field !== data.field) } : d;
          return place(base, data.field, zone, fields);
        });
      } catch { /* Not a field drag. */ }
    };
  }
  function toggleField(field: PivotSourceField, checked: boolean) {
    setDraft((d) => checked
      ? place(d, field.name, isNumeric(field) ? 'values' : 'rows', fields)
      : { ...d, rows: d.rows.filter((f) => f !== field.name), columns: d.columns.filter((f) => f !== field.name), values: d.values.filter((v) => v.field !== field.name), filters: d.filters.filter((f) => f.field !== field.name) });
  }
  async function apply() {
    setError('');
    const input = toInput(draft);
    let id = draft.id;
    try { applySheetPivot(content, input); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法生成透视表'); return; }
    const ok = await commit((latest) => { const result = applySheetPivot(latest, input); id = result.pivot.id; return result.content; });
    if (ok && id) setSelectedId(id);
  }
  async function remove() {
    if (!draft.id) return;
    const id = draft.id;
    if (await commit((latest) => removeChartsForPivot(removeSheetPivot(latest, id), id))) { const rest = pivots.filter((p) => p.id !== id); pick(rest[0]?.id ?? NEW); }
  }
  async function refresh() {
    await commit((latest) => { let next = latest; for (const pivot of sheetPivots(latest)) next = applySheetPivot(next, { id: pivot.id }).content; return next; });
  }

  const boundCharts = selectedPivot ? sheetCharts(content).filter((c) => 'pivotId' in c.source && c.source.pivotId === selectedPivot.id).length : 0;
  const sheetName = (id: string) => content.sheets.find((s) => s.id === id)?.name ?? id;
  const ready = draft.values.length > 0 && !source.error;
  const changed = !selectedPivot || JSON.stringify(toInput(fromPivot(selectedPivot))) !== JSON.stringify(toInput(draft));

  return <aside aria-label="透视表" className="flex w-80 shrink-0 flex-col border-l border-line bg-paper">
    <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
      <h3 className="mr-auto text-sm font-medium">透视表</h3>
      {pivots.length > 0 && <Button size="xs" variant="ghost" disabled={busy} title="重新读取数据源，展开新增的分组" onClick={() => void refresh()}><RefreshCw />全部刷新</Button>}
      <Button size="icon-sm" variant="ghost" aria-label="关闭透视表面板" onClick={onClose}><X /></Button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-xs">
      <div className="flex items-center gap-2">
        <Select value={selectedId} onValueChange={pick}>
          <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="选择透视表"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{pivots.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}<SelectItem value={NEW}>新建透视表</SelectItem></SelectGroup></SelectContent>
        </Select>
        {selectedId !== NEW && <Button size="xs" variant="outline" onClick={() => pick(NEW)}><Plus />新建</Button>}
      </div>

      <label className="flex flex-col gap-1"><span className="text-ink-muted">名称</span><Input className="h-7 text-xs" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>

      <div className="flex flex-col gap-1">
        <span className="text-ink-muted">数据源（含表头）</span>
        <div className="flex items-center gap-1.5">
          <Select value={draft.sourceSheetId} onValueChange={(id) => setDraft({ ...draft, sourceSheetId: id })}>
            <SelectTrigger size="sm" className="w-28" aria-label="数据源工作表"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{content.sheets.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          <Input className="h-7 min-w-0 flex-1 font-mono text-xs" aria-label="数据源范围" placeholder="A1:F200" value={draft.range} onChange={(e) => setDraft({ ...draft, range: e.target.value.toUpperCase() })} />
        </div>
        {selection?.range && <button type="button" className="self-start text-accent hover:underline" onClick={() => { const s = suggestPivotSource(content, selection.sheetId, selection.range); if (s) setDraft({ ...draft, sourceSheetId: s.sheetId, range: s.range }); }}>使用当前选区{selection.range ? `（${selection.range}）` : ''}</button>}
        {source.error && <p className="text-danger">{source.error}</p>}
      </div>

      {fields.length > 0 && <div className="flex flex-col gap-1">
        <span className="text-ink-muted">字段 · 勾选自动放入，或拖到下方区域</span>
        <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded border border-line p-1">
          {fields.map((field) => <li key={field.name} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', JSON.stringify({ field: field.name }))} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-paper-raised">
            <Checkbox checked={used(draft, field.name)} onCheckedChange={(checked) => toggleField(field, checked === true)} aria-label={field.name} />
            <span className="min-w-0 flex-1 truncate">{field.name}</span>
            <span className="text-[10px] text-ink-muted">{isNumeric(field) ? '数值' : '文本'}</span>
            <GripVertical className="size-3 cursor-grab text-ink-muted" />
          </li>)}
        </ul>
      </div>}

      <div className="grid grid-cols-2 gap-2">
        <DropZone zone="filters" onDrop={drop('filters')}>{draft.filters.map((filter) => {
          const options = fields.find((f) => f.name === filter.field)?.values ?? [];
          const has = (v: (typeof options)[number]) => filter.values.some((x) => (x ?? '') === v || String(x ?? '') === String(v));
          const toggle = (v: (typeof options)[number], on: boolean) => setDraft({ ...draft, filters: draft.filters.map((f) => f.field !== filter.field ? f : { ...f, values: on ? [...f.values, v === '' ? null : v] : f.values.filter((x) => String(x ?? '') !== String(v)) }) });
          return <Chip key={filter.field} field={filter.field} zone="filters" onRemove={() => setDraft({ ...draft, filters: draft.filters.filter((f) => f.field !== filter.field) })}>
            <details><summary className="cursor-pointer text-[11px] text-ink-muted">{filter.values.length}/{options.length} 项</summary>
              <ul className="mt-1 flex max-h-32 flex-col gap-0.5 overflow-y-auto">{options.map((v) => <li key={String(v)} className="flex items-center gap-1"><Checkbox checked={has(v)} onCheckedChange={(on) => toggle(v, on === true)} aria-label={pivotFieldLabel(v)} /><span className="truncate">{pivotFieldLabel(v)}</span></li>)}</ul>
            </details>
          </Chip>;
        })}</DropZone>
        <DropZone zone="columns" onDrop={drop('columns')}>{draft.columns.map((field) => <Chip key={field} field={field} zone="columns" onRemove={() => setDraft({ ...draft, columns: [] })} />)}</DropZone>
        <DropZone zone="rows" onDrop={drop('rows')}>{draft.rows.map((field) => <Chip key={field} field={field} zone="rows" onRemove={() => setDraft({ ...draft, rows: draft.rows.filter((f) => f !== field) })} />)}</DropZone>
        <DropZone zone="values" onDrop={drop('values')}>{draft.values.map((value, index) => <Chip key={`${value.field}:${index}`} field={value.field} zone="values" onRemove={() => setDraft({ ...draft, values: draft.values.filter((_, i) => i !== index) })}>
          <Select value={value.agg} onValueChange={(agg) => setDraft({ ...draft, values: draft.values.map((v, i) => i === index ? { ...v, agg: agg as PivotAggregate } : v) })}>
            <SelectTrigger size="sm" className="h-6 w-full text-xs" aria-label={`${value.field} 汇总方式`}><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{(Object.keys(PIVOT_AGG_LABELS) as PivotAggregate[]).map((agg) => <SelectItem key={agg} value={agg}>{PIVOT_AGG_LABELS[agg]}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Chip>)}</DropZone>
      </div>

      <label className="flex items-center gap-1.5"><Checkbox checked={draft.totals} onCheckedChange={(on) => setDraft({ ...draft, totals: on === true })} />显示总计</label>

      <div className="flex flex-col gap-1">
        <span className="text-ink-muted">放置位置</span>
        <Select value={draft.targetMode} onValueChange={(mode) => setDraft({ ...draft, targetMode: mode as TargetMode })}>
          <SelectTrigger size="sm" className="w-full" aria-label="放置位置"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            {draft.id && <SelectItem value="keep">保持原位置（{sheetName(selectedPivot?.target.sheetId ?? draft.targetSheetId)}!{selectedPivot?.output ?? draft.start}）</SelectItem>}
            <SelectItem value="newSheet">新工作表</SelectItem>
            <SelectItem value="sheet">已有工作表的指定位置</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
        {draft.targetMode === 'newSheet' && <Input className="h-7 text-xs" aria-label="新工作表名称" value={draft.newSheet} onChange={(e) => setDraft({ ...draft, newSheet: e.target.value })} />}
        {draft.targetMode === 'sheet' && <div className="flex items-center gap-1.5">
          <Select value={draft.targetSheetId} onValueChange={(id) => setDraft({ ...draft, targetSheetId: id })}>
            <SelectTrigger size="sm" className="w-28" aria-label="目标工作表"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{content.sheets.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          <Input className="h-7 w-20 font-mono text-xs" aria-label="起始单元格" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value.toUpperCase() })} />
        </div>}
      </div>

      {draft.values.length > 0 && <p className="rounded bg-paper-raised px-2 py-1.5 text-ink-muted">{describePivot(draft)}</p>}
      {selectedPivot && !changed && <div className="flex flex-col gap-1">
        <span className="text-ink-muted">透视图{boundCharts ? ` · 已有 ${boundCharts} 个，显示在表格下方` : ''}</span>
        <div className="flex flex-wrap gap-1">{(['column', 'line', 'pie', 'stackedColumn', 'bar'] as SheetChartType[]).map((type) => <Button key={type} size="xs" variant="outline" disabled={busy} onClick={() => void commit((latest) => applySheetChart(latest, { pivotId: selectedPivot.id, type }).content)}>{SHEET_CHART_TYPE_LABELS[type]}</Button>)}</div>
      </div>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </div>
    <div className="flex items-center gap-2 border-t border-line p-3">
      {draft.id && (confirmDelete
        ? <><Button size="xs" variant="destructive" disabled={busy} onClick={() => void remove()}>确认删除</Button><Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button></>
        : <Button size="xs" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 />删除</Button>)}
      <span className="mr-auto" />
      <Button size="sm" disabled={busy || !ready || !changed} onClick={() => void apply()}>{draft.id ? '更新透视表' : '生成透视表'}</Button>
    </div>
  </aside>;
}
