import { expect, it } from 'vitest';
import pptxgen from 'pptxgenjs';
import JSZip from 'jszip';
import { importPresentationPptx } from './presentationImport';
import { presentationElements } from './presentationContent';
import { exportPresentationPptx } from '../renderer/lib/presentationPptx';

export async function pptxFixture(): Promise<Uint8Array> {
  const pptx = new pptxgen(); pptx.layout = 'LAYOUT_WIDE'; const slide = pptx.addSlide();
  slide.addText([{ text: 'Heading ', options: { bold: true } }, { text: '中文', options: { color: 'FF0000', bold: false } }], { x: 1, y: 1, w: 8, h: 1, fontSize: 32, fontFace: 'Arial', margin: 0 });
  slide.addShape(pptx.ShapeType.ellipse, { x: 1, y: 3, w: 2, h: 1, fill: { color: '22AA88' }, rotate: 15 });
  slide.addTable([[{ text: 'A', options: { bold: true } }, { text: 'B' }], [{ text: 'One' }, { text: '100' }]], { x: 4, y: 3, w: 4, h: 1.5, fontSize: 18 });
  slide.addChart(pptx.ChartType.bar, [{ name: 'Sales', labels: ['A', 'B'], values: [10, 20] }], { x: 9, y: 1, w: 3, h: 4 });
  slide.addImage({ data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1cAAAAASUVORK5CYII=', x: 7, y: 5, w: 4, h: 2, sizing: { type: 'crop', x: 1, y: .5, w: 2, h: 1 } });
  slide.addNotes('speaker note');
  return new Uint8Array(await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer);
}

it('imports actual PPTX rich text, geometry, chart categories and table cells and roundtrips them', async () => {
  const content = await importPresentationPptx(await pptxFixture()); const slide = content.slides[0];
  const elements = presentationElements(slide).map((entry) => entry.element);
  const title = elements.find((e) => e.type === 'text')!;
  expect(title.position).toEqual({ x: 96, y: 96 });
  expect((title.runs as { text: string; font: { bold: boolean; color: string; size: number } }[]).map((r) => ({ bold: r.font.bold, color: r.font.color, size: r.font.size }))).toEqual([{ bold: true, color: '000000', size: 32 * 4 / 3 }, { bold: false, color: 'FF0000', size: 32 * 4 / 3 }]);
  expect(elements.find((e) => e.type === 'vector' && e.shape === 'ellipse')).toMatchObject({ rotation: 15, fill: { color: '22AA88' } });
  expect(elements.find((e) => e.type === 'chart')).toMatchObject({ categories: ['A', 'B'], series: [{ name: 'Sales', values: [10, 20] }] });
  expect(JSON.stringify(elements.find((e) => e.type === 'table'))).toContain('One');
  expect(slide.notes).toBe('speaker note');
  expect(elements.find((e) => e.type === 'image')).toMatchObject({ source_crop: { l: 25, r: 25, t: 25, b: 25 } });
  const second = await importPresentationPptx(await exportPresentationPptx(content, 'Round trip'));
  const secondElements = presentationElements(second.slides[0]).map((entry) => entry.element);
  expect(secondElements.find((e) => e.type === 'chart')).toMatchObject({ categories: ['A', 'B'], series: [{ name: 'Sales', values: [10, 20] }] });
  expect(secondElements.find((e) => e.type === 'text')?.position).toEqual({ x: 96, y: 96 });
  expect(JSON.stringify(second)).toContain('中文'); expect(JSON.stringify(second)).toContain('One');
  expect(secondElements.find((e) => e.type === 'image')).toMatchObject({ source_crop: { l: 25, r: 25, t: 25, b: 25 } });
});
it('keeps scaled children relative to the imported group instead of losing the group offset', async () => {
  const p = new pptxgen(); p.layout = 'LAYOUT_WIDE'; const slide = p.addSlide();
  slide.addText('Grouped', { x: 1, y: 1, w: 3, h: 1, margin: 0 });
  const zip = await JSZip.loadAsync(await p.write({ outputType: 'arraybuffer' }) as ArrayBuffer);
  const file = zip.file('ppt/slides/slide1.xml')!; const xml = await file.async('string'); const shape = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/)![0];
  const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="100" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="914400" y="1828800"/><a:ext cx="9144000" cy="4572000"/><a:chOff x="0" y="0"/><a:chExt cx="9144000" cy="4572000"/></a:xfrm></p:grpSpPr>${shape}</p:grpSp>`;
  zip.file('ppt/slides/slide1.xml', xml.replace(shape, group));
  const imported = await importPresentationPptx(await zip.generateAsync({ type: 'uint8array' }));
  const first = imported.slides[0].layout.elements![0];
  expect(first).toMatchObject({ type: 'group', position: { x: 96, y: 192 } });
  expect(first.children?.[0].position).toEqual({ x: 96, y: 96 });
  const roundtrip = await importPresentationPptx(await exportPresentationPptx(imported, 'Group roundtrip'));
  expect(roundtrip.slides[0].layout.elements?.find((e) => e.type === 'text')?.position).toEqual({ x: 192, y: 288 });
});
it('rejects non-PPTX files and oversized uploads without creating a partial deck', async () => {
  await expect(importPresentationPptx(new Uint8Array(8 * 1024 * 1024 + 1))).rejects.toThrow('8 MB');
  const zip = new JSZip(); zip.file('hello.txt', 'not a deck');
  await expect(importPresentationPptx(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow('有效');
});
it('preserves merged cells and unequal column widths as editable cell geometry with an explicit notice', async () => {
  const p = new pptxgen(); p.layout = 'LAYOUT_WIDE';
  p.addSlide().addTable([[{ text: 'Merged', options: { colspan: 2 } }], [{ text: 'A' }, { text: 'B' }]], { x: 1, y: 1, w: 4, h: 1.5, colW: [1, 3], fontSize: 18 });
  const content = await importPresentationPptx(new Uint8Array(await p.write({ outputType: 'arraybuffer' }) as ArrayBuffer));
  const group = content.slides[0].layout.elements![0]; expect(group.type).toBe('group');
  const entries = presentationElements(content.slides[0]).map((e) => e.element);
  const text = entries.filter((e) => e.type === 'text').flatMap((e) => (e.runs as { text: string }[]).map((r) => r.text));
  expect(text).toEqual(['Merged', 'A', 'B']);
  const widths = entries.filter((e) => e.name?.startsWith('单元格 ')).map((e) => { const points = e.points as { x: number }[]; return Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)); });
  expect(widths).toEqual([384, 96, 288]);
  expect(content.importWarnings?.some((warning) => warning.includes('单元格图形'))).toBe(true);
});
