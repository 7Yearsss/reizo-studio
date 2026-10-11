import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { applyDocumentEdit, documentBlocks, parseDocumentContent, type DocumentContent } from '../../../../shared/documentContent';
import { exportDocx, importDocx } from '../documentIO';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
const STYLED = '<w:p><w:pPr><w:jc w:val="center"/><w:keepNext/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:color w:val="FF0000"/><w:sz w:val="48"/></w:rPr><w:t>Styled sample</w:t></w:r></w:p>';
const PLAIN = '<w:p><w:r><w:t>项目预计十月上线。</w:t></w:r></w:p>';
const HEADING = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章</w:t></w:r></w:p>';
const BOOKMARK = '<w:bookmarkStart w:id="0" w:name="mark"/>';
const TABLE = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:shd w:val="clear" w:fill="FFFF00"/></w:tcPr><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
const LIST = ['苹果', '香蕉'].map((t) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`).join('');
const SECT = '<w:sectPr><w:headerReference w:type="default" r:id="rId9"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>';
const HEADER_XML = `<w:hdr ${NS}><w:p><w:r><w:t>页眉文字</w:t></w:r></w:p></w:hdr>`;

async function fixture(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${STYLED}${PLAIN}${BOOKMARK}${HEADING}${TABLE}${LIST}${SECT}</w:body></w:document>`);
  zip.file('word/styles.xml', `<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style></w:styles>`);
  zip.file('word/numbering.xml', `<w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`);
  zip.file('word/header1.xml', HEADER_XML);
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>');
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
}
async function documentXml(bytes: Uint8Array): Promise<string> { return (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string'); }
const blockText = (content: DocumentContent, text: string) => documentBlocks(content).find((b) => b.text === text)!;

describe('DOCX fidelity', () => {
  it('imports centred, coloured, sized, custom-font text without losing it', async () => {
    const content = await importDocx(await fixture());
    const styled = content.doc.content![0];
    expect(styled.attrs).toMatchObject({ textAlign: 'center' });
    expect(styled.content![0].marks).toContainEqual({ type: 'runStyle', attrs: { color: 'ff0000', size: 24, font: 'Microsoft YaHei', highlight: null, vert: null } });
    expect(content.docx?.typography).toMatchObject({ fontFamily: '宋体', fontSize: 10.5 });
    // Text matching the document default carries no explicit style; headings keep their Word style.
    expect(content.doc.content![1].content![0].marks).toBeUndefined();
    expect(content.doc.content![2]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    expect(content.doc.content!.map((n) => n.type)).toEqual(['paragraph', 'paragraph', 'heading', 'table', 'bulletList']);
    expect(JSON.stringify(content.doc.content![3])).toContain('"background":"ffff00"');
  });

  it('returns the original file untouched when nothing changed', async () => {
    const original = await fixture();
    const content = parseDocumentContent(JSON.stringify(await importDocx(original)))!;
    expect(Buffer.from(await exportDocx(content, original)).equals(original)).toBe(true);
  });

  it('rewrites only the edited paragraph and keeps header, table, list and bookmark intact', async () => {
    const original = await fixture();
    const content = parseDocumentContent(JSON.stringify(await importDocx(original)))!;
    const block = blockText(content, '项目预计十月上线。');
    const edited = applyDocumentEdit(content, { op: 'replaceText', blockId: block.id, start: 4, end: 6, text: '十一月' });
    const out = await exportDocx(edited, original);
    const xml = await documentXml(out);
    for (const kept of [STYLED, BOOKMARK, HEADING, TABLE, LIST, SECT]) expect(xml).toContain(kept);
    expect(xml).not.toContain(PLAIN); expect(xml).toContain('项目预计十一月上线。');
    expect(await (await JSZip.loadAsync(out)).file('word/header1.xml')!.async('string')).toBe(HEADER_XML);
    expect(xml.indexOf(STYLED)).toBeLessThan(xml.indexOf('十一月')); expect(xml.indexOf('十一月')).toBeLessThan(xml.indexOf(BOOKMARK));
  });

  it('keeps alignment, colour, size and font when a styled paragraph itself is edited', async () => {
    const original = await fixture();
    const content = parseDocumentContent(JSON.stringify(await importDocx(original)))!;
    const block = blockText(content, 'Styled sample');
    const edited = applyDocumentEdit(content, { op: 'replaceText', blockId: block.id, start: 7, end: 13, text: 'text' });
    const xml = await documentXml(await exportDocx(edited, original));
    expect(xml).toContain('Styled text');
    const paragraph = xml.slice(xml.indexOf('<w:p>'), xml.indexOf('</w:p>') + 6);
    expect(paragraph).toContain('<w:jc w:val="center"/>'); expect(paragraph).toContain('<w:keepNext/>');
    expect(paragraph).toContain('<w:color w:val="FF0000"/>'); expect(paragraph).toContain('<w:sz w:val="48"/>'); expect(paragraph).toContain('w:ascii="Microsoft YaHei"');
    const reimported = await importDocx(Buffer.from(await exportDocx(edited, original)));
    expect(reimported.doc.content![0]).toMatchObject({ attrs: { textAlign: 'center' } });
  });

  it('drops only the deleted block and adds new blocks with their own XML', async () => {
    const original = await fixture();
    const content = parseDocumentContent(JSON.stringify(await importDocx(original)))!;
    const first = documentBlocks(content)[0];
    const edited = applyDocumentEdit(applyDocumentEdit(content, { op: 'deleteBlock', blockId: blockText(content, '项目预计十月上线。').id }),
      { op: 'insertBlocks', afterId: first.id, nodes: [{ type: 'paragraph', content: [{ type: 'text', text: '新增', marks: [{ type: 'bold' }] }] }] });
    const xml = await documentXml(await exportDocx(edited, original));
    expect(xml).not.toContain('项目预计十月上线。'); expect(xml).toContain('<w:b/>'); expect(xml).toContain('新增');
    for (const kept of [STYLED, TABLE, LIST, SECT, BOOKMARK]) expect(xml).toContain(kept);
  });
});

describe('tracked-changes export', () => {
  it('writes an edit as a minimal deletion + insertion and leaves untouched blocks verbatim', async () => {
    const original = await fixture();
    const content = parseDocumentContent(JSON.stringify(await importDocx(original)))!;
    const block = blockText(content, '项目预计十月上线。');
    const edited = applyDocumentEdit(content, { op: 'replaceText', blockId: block.id, start: 4, end: 6, text: '十一月' });
    const xml = await documentXml(await exportDocx(edited, original, { revisions: { author: 'Reizo', date: '2026-10-11T00:00:00Z' } }));
    expect(xml).toMatch(/<w:ins w:id="\d+" w:author="Reizo" w:date="2026-10-11T00:00:00Z"><w:r><w:t xml:space="preserve">一<\/w:t><\/w:r><\/w:ins>/);
    expect(xml).toContain('项目预计十');
    for (const kept of [STYLED, BOOKMARK, HEADING, TABLE, LIST, SECT]) expect(xml).toContain(kept);
    // Without revisions the same edit is applied silently.
    expect(await documentXml(await exportDocx(edited, original))).not.toContain('<w:ins');
  });

  it('keeps a deleted block in place, struck through, and marks a new block as inserted', async () => {
    const original = await fixture();
    const content = parseDocumentContent(JSON.stringify(await importDocx(original)))!;
    const first = documentBlocks(content)[0];
    const edited = applyDocumentEdit(applyDocumentEdit(content, { op: 'deleteBlock', blockId: blockText(content, '项目预计十月上线。').id }),
      { op: 'insertBlocks', afterId: first.id, nodes: [{ type: 'paragraph', content: [{ type: 'text', text: '新增' }] }] });
    const xml = await documentXml(await exportDocx(edited, original, { revisions: { author: 'Reizo' } }));
    expect(xml).toMatch(/<w:del [^>]*><w:r><w:delText>项目预计十月上线。<\/w:delText><\/w:r><\/w:del>/);
    expect(xml).not.toContain('<w:t>项目预计十月上线。</w:t>');
    expect(xml).toMatch(/<w:pPr><w:rPr><w:ins [^>]*\/><\/w:rPr><\/w:pPr><w:ins [^>]*><w:r><w:t xml:space="preserve">新增<\/w:t><\/w:r><\/w:ins>/);
    // The struck paragraph's mark is deleted too, and the document still reads back as the edited text.
    expect(xml).toMatch(/<w:rPr><w:del [^>]*\/><\/w:rPr>/);
    const reread = await importDocx(Buffer.from(await exportDocx(edited, original, { revisions: { author: 'Reizo' } })));
    const texts = documentBlocks(reread).map((b) => b.text);
    expect(texts).toContain('新增');
    expect(texts).not.toContain('项目预计十月上线。');
  });

  it('diffs paragraphs inside an unchanged table structure', async () => {
    const original = await fixture();
    const content = parseDocumentContent(JSON.stringify(await importDocx(original)))!;
    const cell = documentBlocks(content).find((b) => b.type === 'paragraph' && b.text.length > 0 && !['Styled sample', '项目预计十月上线。'].includes(b.text) && b.text !== '苹果' && b.text !== '香蕉')!;
    const edited = applyDocumentEdit(content, { op: 'replaceText', blockId: cell.id, start: 0, end: cell.inlineSize, text: '改过的单元格' });
    const xml = await documentXml(await exportDocx(edited, original, { revisions: {} }));
    expect(xml).toContain('<w:delText');
    expect(xml).toContain('改过的单元格');
    expect(xml).toContain('<w:tbl>');
  });
});
