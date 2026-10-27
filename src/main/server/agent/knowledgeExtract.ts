import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import mammoth from 'mammoth';

export class UnsupportedKnowledgeFile extends Error {}

const MAX_SHEET_ROWS = 5000;

function decodeXml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

async function xlsxText(bytes: Uint8Array): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  const parts: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, number) => {
      if (number > MAX_SHEET_ROWS) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => { cells.push(String(cell.text ?? '').replace(/\s+/g, ' ').trim()); });
      if (cells.some(Boolean)) rows.push(cells.join('\t'));
    });
    if (rows.length > 0) parts.push(`## ${sheet.name}\n${rows.join('\n')}`);
  });
  return parts.join('\n\n');
}

async function pptxText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files)
    .map((path) => ({ path, n: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(path)?.[1]) }))
    .filter((s) => Number.isFinite(s.n))
    .sort((a, b) => a.n - b.n);
  const parts: string[] = [];
  for (const slide of slides) {
    const xml = await zip.file(slide.path)!.async('string');
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]).trim()).filter(Boolean);
    if (texts.length > 0) parts.push(`## 第 ${slide.n} 页\n${texts.join('\n')}`);
  }
  return parts.join('\n\n');
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  // Loaded on demand so the PDF reader only costs anything when someone imports a PDF.
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = text.map((t, i) => ({ n: i + 1, t: t.replace(/[ \t]+/g, ' ').trim() })).filter((p) => p.t);
  if (pages.length === 0 && totalPages > 0) throw new UnsupportedKnowledgeFile('这份 PDF 里没有可选取的文字（可能是扫描件/图片），暂时无法导入');
  return pages.map((p) => `## 第 ${p.n} 页\n${p.t}`).join('\n\n');
}

/** Plain text out of the office formats people actually keep their material in. PDF is not readable yet and says so. */
export async function extractKnowledgeText(name: string, bytes: Uint8Array): Promise<string> {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  try {
    if (ext === 'docx') return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value.trim();
    if (ext === 'xlsx') return (await xlsxText(bytes)).trim();
    if (ext === 'pptx') return (await pptxText(bytes)).trim();
    if (ext === 'pdf') return (await pdfText(bytes)).trim();
  } catch (error) {
    if (error instanceof UnsupportedKnowledgeFile) throw error;
    throw new UnsupportedKnowledgeFile(`「${name}」读取失败，文件可能已损坏或有密码保护`);
  }
  if (ext === 'doc' || ext === 'xls' || ext === 'ppt') throw new UnsupportedKnowledgeFile(`旧版 .${ext} 格式不支持，请在 Office 里另存为 .${ext}x`);
  return new TextDecoder('utf-8').decode(bytes);
}
