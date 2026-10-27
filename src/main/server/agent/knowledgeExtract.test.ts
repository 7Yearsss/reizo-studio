import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { extractKnowledgeText, UnsupportedKnowledgeFile } from './knowledgeExtract';

async function docx(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('extractKnowledgeText', () => {
  it('reads Word, Excel and PowerPoint, keeping sheet and slide labels', async () => {
    expect(await extractKnowledgeText('政策.docx', await docx('退款七天内可申请'))).toContain('退款七天内可申请');

    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('价格表');
    sheet.addRow(['商品', '价格']);
    sheet.addRow(['杯子', 29]);
    const xlsx = new Uint8Array(await book.xlsx.writeBuffer());
    const sheetText = await extractKnowledgeText('价格.xlsx', xlsx);
    expect(sheetText).toContain('## 价格表');
    expect(sheetText).toContain('杯子\t29');

    const pptx = new JSZip();
    pptx.file('ppt/slides/slide2.xml', '<p:sld><a:t>第二页 &amp; 标题</a:t></p:sld>');
    pptx.file('ppt/slides/slide1.xml', '<p:sld><a:t>开场</a:t><a:t>要点一</a:t></p:sld>');
    const slides = await extractKnowledgeText('介绍.pptx', await pptx.generateAsync({ type: 'uint8array' }));
    expect(slides.indexOf('第 1 页')).toBeLessThan(slides.indexOf('第 2 页'));
    expect(slides).toContain('第二页 & 标题');
  });

  it('says what to do about PDF, old formats and broken files, and passes plain text through', async () => {
    await expect(extractKnowledgeText('a.pdf', new Uint8Array([1]))).rejects.toThrow(UnsupportedKnowledgeFile);
    await expect(extractKnowledgeText('a.doc', new Uint8Array([1]))).rejects.toThrow('另存为');
    await expect(extractKnowledgeText('bad.docx', new Uint8Array([1, 2, 3]))).rejects.toThrow('读取失败');
    expect(await extractKnowledgeText('n.md', new TextEncoder().encode('# 标题'))).toBe('# 标题');
  });
});
