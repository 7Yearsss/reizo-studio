export const MAX_SHEET_UPLOAD_BYTES = 8 * 1024 * 1024;

export function isSpreadsheetFile(file: { name: string; type?: string }): boolean {
  return /\.xlsx$/i.test(file.name);
}

export function isLegacyXlsFile(file: { name: string; type?: string }): boolean {
  return /\.xls$/i.test(file.name);
}

export function workbookTitleFromFileName(name: string): string {
  return (name.trim().replace(/\.xlsx$/i, '').trim() || '工作簿').slice(0, 80);
}
