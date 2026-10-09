import { z } from 'zod';
import { parseSheetContent, serializeSheetContent, type SheetArtifactContent } from '../../../shared/sheetContent';
import {
  applySheetReviewOperations,
  diffSheetContent,
  formatSheetCell,
  formatSheetDiffCounts,
  isEmptySheetDiff,
  sheetOperationVerb,
  sheetReviewTarget,
  sheetTargetsOverlap,
  type SheetReviewOperation,
} from '../../../shared/sheetReview';
import type { ArtifactReviewAdapter } from '../storage/artifactReviewStore';

const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const sheetEditSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('setValues'), sheet: z.string().optional(), start: z.string().describe('起始单元格，如 "A1"'), values: z.array(z.array(cellValue)).min(1).describe('二维单元格值数组') }),
  z.object({ op: z.literal('setFormulas'), sheet: z.string().optional(), start: z.string().describe('起始单元格，如 "C2"'), formulas: z.array(z.array(z.string())).min(1).describe('二维公式数组') }),
  z.object({ op: z.literal('clearRange'), sheet: z.string().optional(), range: z.string().describe('清除范围，如 "A1:C10"') }),
  z.object({
    op: z.literal('addSheet'),
    name: z.string().min(1).max(80),
    values: z.array(z.array(cellValue)).optional().describe('新工作表从 A1 开始的数据'),
    formulas: z.array(z.object({ cell: z.string(), formula: z.string() })).optional().describe('新工作表的公式'),
  }),
  z.object({ op: z.literal('renameSheet'), sheet: z.string(), name: z.string().min(1).max(80) }),
  z.object({ op: z.literal('deleteSheet'), sheet: z.string() }),
  z.object({
    op: z.literal('upsertPivot'),
    pivot: z.object({
      id: z.string().optional().describe('更新已有透视表时传 read_sheet 返回的 pivots[].id；新建时省略'),
      name: z.string().max(80).optional(),
      source: z.object({ sheet: z.string().optional(), range: z.string().describe('含表头行的数据区域，如 "A1:F500"') }).optional().describe('新建时必填'),
      rows: z.array(z.string()).max(3).optional().describe('行字段（表头名称），最多 3 个'),
      columns: z.array(z.string()).max(1).optional().describe('列字段（表头名称），最多 1 个'),
      values: z.array(z.object({ field: z.string(), agg: z.enum(['sum', 'count', 'average', 'min', 'max']) })).min(1).max(4).optional().describe('值字段与汇总方式；新建时必填'),
      filters: z.array(z.object({ field: z.string(), values: z.array(cellValue).min(1) })).max(5).optional().describe('只保留字段取这些值的行'),
      target: z.object({ sheet: z.string().optional(), newSheet: z.string().max(80).optional().describe('放到新建的工作表'), start: z.string().optional().describe('结果左上角，如 "H1"') }).optional(),
      totals: z.boolean().optional().describe('是否包含总计行/列，默认 true'),
    }),
  }),
  z.object({ op: z.literal('deletePivot'), id: z.string().describe('同时删除绑定它的图表') }),
  z.object({
    op: z.literal('upsertChart'),
    chart: z.object({
      id: z.string().optional().describe('更新已有图表时传 read_sheet 返回的 charts[].id'),
      name: z.string().max(80).optional(),
      type: z.enum(['column', 'bar', 'line', 'pie', 'stackedColumn']).optional().describe('默认 column；时间趋势用 line；占比且分类少用 pie'),
      pivotId: z.string().optional().describe('绑定透视表（推荐），自动去掉总计并随透视表更新'),
      source: z.object({ sheet: z.string().optional(), range: z.string().describe('首行为系列名、首列为分类的区域') }).optional(),
      anchor: z.object({ sheet: z.string().optional(), cell: z.string() }).optional().describe('导出 Excel 时图片左上角位置'),
    }),
  }),
  z.object({ op: z.literal('deleteChart'), id: z.string() }),
]);

const PREVIEW_CELLS = 40;

function read(content: string): SheetArtifactContent {
  const parsed = parseSheetContent(content);
  if (!parsed) throw new Error('表格内容无法解析');
  return parsed;
}

function parseOperation(value: unknown): SheetReviewOperation {
  return sheetEditSchema.parse(value) as SheetReviewOperation;
}

function preview(lines: string[], total: number): string {
  return [...lines, ...(total > lines.length ? [`… 另有 ${total - lines.length} 处`] : [])].join('\n');
}

export const sheetReviewAdapter: ArtifactReviewAdapter = {
  prepare(_content, operations) {
    return operations.map(parseOperation);
  },
  apply(content, operations) {
    if (!operations.length) return content;
    return serializeSheetContent(applySheetReviewOperations(read(content), operations.map(parseOperation)));
  },
  describe(content, operation) {
    const edit = parseOperation(operation);
    const base = read(content);
    let label = sheetOperationVerb(edit);
    try { label = `${sheetReviewTarget(base, edit).label} · ${label}`; } catch { /* The label stays generic for an operation that no longer resolves. */ }
    try {
      const diff = diffSheetContent(base, applySheetReviewOperations(base, [edit]));
      const cells = diff.sheets.flatMap((sheet) => sheet.cells.map((cell) => ({ sheet: sheet.name, ...cell })));
      const shown = cells.slice(0, PREVIEW_CELLS);
      return {
        label: `${label}（${formatSheetDiffCounts(diff)}）`,
        before: preview(shown.map((cell) => `${cell.sheet}!${cell.a1}: ${formatSheetCell(cell.before)}`), cells.length),
        after: preview(shown.map((cell) => `${cell.sheet}!${cell.a1}: ${formatSheetCell(cell.after)}`), cells.length),
      };
    } catch (error) {
      return { label, before: '', after: error instanceof Error ? error.message : '无法应用该修改' };
    }
  },
  validateBatch(content, operations) {
    const base = read(content);
    const targets = operations.map((value, index) => {
      const edit = parseOperation(value);
      let target;
      try {
        target = sheetReviewTarget(base, edit);
        if (isEmptySheetDiff(diffSheetContent(base, applySheetReviewOperations(base, [edit])))) throw new Error('没有实际修改');
      } catch (error) {
        throw new Error(`第 ${index + 1} 项：${error instanceof Error ? error.message : '无法应用'}。每项修改都需能基于当前表格单独接受；新工作表的数据请放进 addSheet 的 values/formulas。`);
      }
      return target;
    });
    targets.forEach((target, index) => {
      const other = targets.findIndex((item, j) => j < index && sheetTargetsOverlap(item, target));
      if (other >= 0) throw new Error(`第 ${other + 1} 项与第 ${index + 1} 项作用于重叠的范围或同一工作表，请合并为一项`);
    });
  },
};
