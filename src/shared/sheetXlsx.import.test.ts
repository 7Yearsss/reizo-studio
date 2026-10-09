import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { applySheetOperations, getCell, workbookFromCreateSheets } from "./sheetContent";
import {
  isLegacyXlsFile,
  isSpreadsheetFile,
  workbookTitleFromFileName,
} from "./sheetFile";
import { parseXlsxToSheetContent, sheetContentToXlsxBuffer } from "./sheetXlsx";

async function xlsxBytes(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe("spreadsheet file detection", () => {
  it("accepts xlsx names and mime types", () => {
    expect(
      isSpreadsheetFile({
        name: "a.xlsx",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toBe(true);
    expect(isSpreadsheetFile({ name: "notes.csv", type: "text/csv" })).toBe(false);
    expect(isLegacyXlsFile({ name: "old.xls", type: "application/vnd.ms-excel" })).toBe(true);
  });

  it("strips the extension for the artifact title", () => {
    expect(workbookTitleFromFileName("明泰克斯(Mintex)OE对应.xlsx")).toBe(
      "明泰克斯(Mintex)OE对应",
    );
  });
});

describe("parseXlsxToSheetContent", () => {
  it("imports values and formulas from multiple worksheets", async () => {
    const bytes = await xlsxBytes((wb) => {
      const prices = wb.addWorksheet("价格");
      prices.getCell("A1").value = "OE号";
      prices.getCell("B1").value = "价格";
      prices.getCell("A2").value = "123";
      prices.getCell("B2").value = 88.5;
      prices.getCell("B3").value = { formula: "SUM(B2)", result: 88.5 };
      wb.addWorksheet("备注").getCell("A1").value = "Mintex";
    });

    const parsed = await parseXlsxToSheetContent(bytes, "mintex.xlsx");
    expect("content" in parsed).toBe(true);
    if (!("content" in parsed)) return;
    expect(parsed.content.sheets.map((s) => s.name)).toEqual(["价格", "备注"]);
    expect(getCell(parsed.content.sheets[0]!, 0, 0)?.v).toBe("OE号");
    expect(getCell(parsed.content.sheets[0]!, 1, 1)?.v).toBe(88.5);
    expect(getCell(parsed.content.sheets[0]!, 2, 1)?.f).toBe("=SUM(B2)");
    expect(parsed.content.importMeta?.sourceName).toBe("mintex.xlsx");
  });

  it("rejects an empty buffer", async () => {
    const parsed = await parseXlsxToSheetContent(Buffer.from("not-xlsx"), "bad.xlsx");
    expect("error" in parsed).toBe(true);
  });

  it("captures font/fill/numFmt/merges/column-width into a Univer snapshot", async () => {
    const bytes = await xlsxBytes((wb) => {
      const sheet = wb.addWorksheet("样式");
      const header = sheet.getCell("A1");
      header.value = "标题";
      header.font = { bold: true, color: { argb: "FFFFFFFF" } };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
      header.numFmt = "0.00%";
      sheet.getColumn(1).width = 20;
      sheet.mergeCells("A1:B1");
    });

    const parsed = await parseXlsxToSheetContent(bytes, "styled.xlsx");
    expect("content" in parsed).toBe(true);
    if (!("content" in parsed)) return;

    const snapshot = parsed.content.univerSnapshot as {
      styles: Record<string, { bl?: number; bg?: { rgb?: string }; n?: { pattern: string } }>;
      sheets: Record<
        string,
        {
          cellData: Record<string, Record<string, { s?: string }>>;
          mergeData?: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }>;
          columnData?: Record<string, { w: number }>;
        }
      >;
    };
    const sheetId = parsed.content.sheets[0]!.id;
    const worksheet = snapshot.sheets[sheetId]!;
    const cell = worksheet.cellData["0"]!["0"]!;
    expect(cell.s).toBeDefined();

    const style = snapshot.styles[cell.s!]!;
    expect(style.bl).toBe(1);
    expect(style.bg?.rgb).toBe("#4472C4");
    expect(style.n?.pattern).toBe("0.00%");

    expect(worksheet.mergeData).toEqual([{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }]);
    expect(worksheet.columnData?.["0"]?.w).toBeGreaterThan(0);
  });
});

describe("sheetContentToXlsxBuffer", () => {
  it("round-trips a style through import -> agent edit -> export", async () => {
    const bytes = await xlsxBytes((wb) => {
      const sheet = wb.addWorksheet("样式");
      const header = sheet.getCell("A1");
      header.value = "old";
      header.font = { bold: true, color: { argb: "FFFFFFFF" } };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
      sheet.mergeCells("A1:B1");
    });

    const imported = await parseXlsxToSheetContent(bytes, "styled.xlsx");
    if (!("content" in imported)) throw new Error(imported.error);

    // Simulate the AI editing a cell — this must not blow away the style.
    const edited = applySheetOperations(imported.content, [
      { op: "setValues", start: "A1", values: [["new"]] },
    ]);
    if (!("content" in edited)) throw new Error(edited.error);

    const exported = await sheetContentToXlsxBuffer(edited.content);
    const roundTrip = new ExcelJS.Workbook();
    await roundTrip.xlsx.load(new Uint8Array(exported).buffer);
    const worksheet = roundTrip.worksheets[0]!;
    const cell = worksheet.getCell("A1");

    expect(cell.value).toBe("new");
    expect(cell.font?.bold).toBe(true);
    expect((cell.fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FF4472C4");
    expect(worksheet.model.merges).toEqual(["A1:B1"]);
  });

  it("falls back to plain values for a workbook with no Univer snapshot", async () => {
    const created = workbookFromCreateSheets([{ name: "计划", values: [["a", "b"], [1, 2]] }]);
    if (!("content" in created)) throw new Error(created.error);

    const exported = await sheetContentToXlsxBuffer(created.content);
    const roundTrip = new ExcelJS.Workbook();
    await roundTrip.xlsx.load(new Uint8Array(exported).buffer);
    const worksheet = roundTrip.worksheets[0]!;

    expect(worksheet.getCell("A1").value).toBe("a");
    expect(worksheet.getCell("B2").value).toBe(2);
  });
});
