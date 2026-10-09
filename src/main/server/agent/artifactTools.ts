import { tool } from 'ai';
import { z } from 'zod';
import type { ArtifactStore } from '../storage/artifactStore';
import { ArtifactVersionConflictError } from '../storage/artifactStore';
import { summarizeSheet } from '../../../shared/sheetReferences';
import { READ_PAGE_BUDGET } from './readBudget';
import { serializeCanvasContent } from '../../../shared/canvasContent';
import {
  applySheetOperations,
  parseSheetContent,
  serializeSheetContent,
  workbookFromCreateSheets,
  type SheetCreateSheet,
  type SheetOperation,
} from '../../../shared/sheetContent';

export function createArtifactTools(options: {
  sessionId: string;
  projectId?: string | null;
  artifactStore: ArtifactStore;
}) {
  return {
    read_sheet: tool({
      description: '读取本会话表格的最新版本、数据和公式。不提供 artifactId 时列出工作簿；读取指定 sheet/range 可查看左上角预览之外的数据。修改前读取并使用返回的 version 作为 expectedVersion。',
      inputSchema: z.object({ artifactId: z.string().optional(), sheet: z.string().optional(), range: z.string().optional() }),
      execute: async ({ artifactId, sheet, range }) => {
        if (!artifactId) return { ok: true, workbooks: (await options.artifactStore.listBySession(options.sessionId)).filter((a) => a.kind === 'sheet').map((a) => ({ artifactId: a.id, name: a.name, version: a.version })) };
        const artifact = await options.artifactStore.get(artifactId);
        if (!artifact || artifact.sessionId !== options.sessionId || artifact.kind !== 'sheet') return { ok: false, error: '未找到本会话的表格' };
        const content = parseSheetContent(artifact.content);
        if (!content) return { ok: false, error: '表格内容无法解析' };
        return { ok: true, artifactId, name: artifact.name, version: artifact.version, sheets: content.sheets.map((s) => ({ id: s.id, name: s.name })), summary: summarizeSheet(content, { sheet, range }, READ_PAGE_BUDGET) };
      },
    }),
    generate_diagram: tool({
      description:
        '生成流程图、时序图、系统架构图、类图或思维导图等白板矢量图表。请编写标准的 Mermaid 语法（如 flowchart TD 或 sequenceDiagram 等），系统将自动将其转绘为可交互的 Excalidraw 画布并放入右侧产物区供用户查看和手绘编辑。若需更新已有图表，请传入 sourceArtifactId。',
      inputSchema: z.object({
        title: z.string().describe('图表标题，例如 "用户登录与鉴权时序图" 或 "系统微服务架构图"'),
        mermaid: z.string().describe('Mermaid 语法代码，例如 "flowchart TD\\nA[客户端] --> B[API网关] --> C[服务集群]"'),
        sourceArtifactId: z.string().optional().describe('已有图表产物 ID（若需更新已有图表）'),
      }),
      execute: async ({ title, mermaid, sourceArtifactId }) => {
        const cleanTitle = title.trim();
        const content = serializeCanvasContent({ mermaidSource: mermaid });
        if (sourceArtifactId) {
          const existing = await options.artifactStore.get(sourceArtifactId);
          if (!existing || existing.sessionId !== options.sessionId || !['diagram', 'sketch'].includes(existing.kind)) return { ok: false, error: '未找到本会话的图表；该工具不能修改 Office 文档或其他类型产物' };
          if (existing) {
            await options.artifactStore.addVersion(sourceArtifactId, {
              content,
              expectedVersion: existing.version,
              origin: { surface: 'chat', prompt: `更新流程图: ${cleanTitle}` },
            });
            return {
              ok: true,
              artifactId: sourceArtifactId,
              name: existing.name,
              summary: `已更新流程图 "${existing.name}" (ID: ${sourceArtifactId})，已在右侧产物区展示。`,
            };
          }
        }
        const artifact = await options.artifactStore.createOrAddVersion({
          sessionId: options.sessionId,
          projectId: options.projectId ?? null,
          name: cleanTitle.endsWith('.mmd') || cleanTitle.endsWith('.excalidraw') ? cleanTitle : `${cleanTitle}.mmd`,
          kind: 'diagram',
          content,
          source: 'generated',
          origin: { surface: 'chat', prompt: `生成流程图: ${cleanTitle}` },
        });
        return {
          ok: true,
          artifactId: artifact.id,
          name: artifact.name,
          summary: `已生成流程图 "${artifact.name}" (ID: ${artifact.id})，已在右侧产物区打开。`,
        };
      },
    }),

    generate_sheet: tool({
      description:
        '创建或更新可编辑的 Excel 工作簿，支持多工作表、数据和函数公式。右侧 Excel 面板可编辑并导出 .xlsx。修改已有表格前使用 read_sheet 读取最新内容和 version，传入 sourceArtifactId、expectedVersion 和 operations 局部修改。',
      inputSchema: z.object({
        title: z.string().describe('表格标题，例如 "2026年Q1财务预算表" 或 "研发任务跟踪表"'),
        sourceArtifactId: z.string().optional().describe('已有表格产物 ID（用于局部修改）'),
        expectedVersion: z.number().int().positive().optional().describe('修改已有表格时必填，使用上下文或 read_sheet 返回的 version；版本变化时重新读取'),
        sheets: z
          .array(
            z.object({
              name: z.string().describe('工作表名称，如 "Sheet1" 或 "汇总"'),
              values: z.array(z.array(z.any())).optional().describe('二维数据矩阵，例如 [["姓名", "得分"], ["张三", 95]]'),
              formulas: z
                .array(
                  z.object({
                    cell: z.string().describe('单元格 A1 地址，例如 "B10"'),
                    formula: z.string().describe('公式，例如 "=SUM(B2:B9)"'),
                  }),
                )
                .optional()
                .describe('公式列表'),
            }),
          )
          .optional()
          .describe('创建工作簿时的工作表列表'),
        operations: z
          .array(
            z.discriminatedUnion('op', [
              z.object({
                op: z.literal('setValues'),
                sheet: z.string().optional(),
                start: z.string().describe('起始单元格，如 "A1"'),
                values: z.array(z.array(z.any())).describe('二维单元格值数组'),
              }),
              z.object({
                op: z.literal('setFormulas'),
                sheet: z.string().optional(),
                start: z.string().describe('起始单元格，如 "C2"'),
                formulas: z.array(z.array(z.string())).describe('二维公式数组'),
              }),
              z.object({
                op: z.literal('clearRange'),
                sheet: z.string().optional(),
                range: z.string().describe('清除范围，如 "A1:C10"'),
              }),
              z.object({
                op: z.literal('addSheet'),
                name: z.string().describe('新增工作表名称'),
              }),
              z.object({
                op: z.literal('renameSheet'),
                sheet: z.string().describe('原工作表名称或ID'),
                name: z.string().describe('新工作表名称'),
              }),
              z.object({
                op: z.literal('deleteSheet'),
                sheet: z.string().describe('要删除的工作表名称或ID'),
              }),
            ]),
          )
          .optional()
          .describe('针对已有表格的局部修改指令列表'),
      }),
      execute: async ({ title, sourceArtifactId, expectedVersion, sheets, operations }) => {
        const cleanTitle = title.trim();
        if (sourceArtifactId) {
          const existing = await options.artifactStore.get(sourceArtifactId);
          if (!existing || existing.sessionId !== options.sessionId || existing.kind !== 'sheet') {
            return { ok: false, error: `未找到指定表格产物: ${sourceArtifactId}` };
          }
          if (expectedVersion !== existing.version) return { ok: false, error: '请先 read_sheet 读取最新版本，并提供匹配的 expectedVersion；本次未修改表格' };
          const existingContent = parseSheetContent(existing.content);
          if (!existingContent) {
            return { ok: false, error: '已有表格内容无法解析' };
          }
          if (!operations?.length) {
            return { ok: false, error: '修改已有表格需要提供 operations 操作指令' };
          }
          const patched = applySheetOperations(existingContent, operations as SheetOperation[]);
          if ('error' in patched) {
            return { ok: false, error: patched.error };
          }
          let updated;
          try { updated = await options.artifactStore.addVersion(sourceArtifactId, {
            expectedVersion,
            content: serializeSheetContent(patched.content),
            origin: { surface: 'chat', prompt: `更新表格: ${cleanTitle}` },
          }); } catch (error) {
            if (error instanceof ArtifactVersionConflictError) return { ok: false, error: error.message };
            throw error;
          }
          return {
            ok: true,
            artifactId: sourceArtifactId,
            name: existing.name,
            version: updated?.version,
            summary: `已更新表格 "${existing.name}" (版本: v${patched.content.revision})，已在右侧产物区展示。`,
          };
        }

        let contentResult = sheets?.length
          ? workbookFromCreateSheets(sheets as SheetCreateSheet[])
          : workbookFromCreateSheets([{ name: 'Sheet1' }]);
        if ('error' in contentResult) {
          return { ok: false, error: contentResult.error };
        }
        if (operations?.length) {
          contentResult = applySheetOperations(contentResult.content, operations as SheetOperation[]);
          if ('error' in contentResult) {
            return { ok: false, error: contentResult.error };
          }
        }
        const artifact = await options.artifactStore.create({
          sessionId: options.sessionId,
          projectId: options.projectId ?? null,
          name: cleanTitle.endsWith('.xlsx') || cleanTitle.endsWith('.sheet.json') ? cleanTitle : `${cleanTitle}.xlsx`,
          kind: 'sheet',
          content: serializeSheetContent(contentResult.content),
          source: 'generated',
          origin: { surface: 'chat', prompt: `生成表格: ${cleanTitle}` },
        });
        return {
          ok: true,
          artifactId: artifact.id,
          name: artifact.name,
          summary: `已创建表格 "${artifact.name}" (ID: ${artifact.id})，已在右侧产物区打开。`,
        };
      },
    }),
  };
}
