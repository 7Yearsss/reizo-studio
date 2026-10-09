import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { createPresentation, normalizePresentation } from '../../shared/presentationContent';
import { exportPresentationPptx, presentationImagePlacement } from './presentationPptx';

it('writes editable text, shapes, tables and charts instead of flattening the page to an image', async () => {
  const deck = createPresentation('可编辑标题');
  deck.slides[0].layout.elements!.push(
    { type: 'vector', name: 'rectangle', points: [{ x: 100, y: 500 }, { x: 300, y: 500 }, { x: 300, y: 600 }, { x: 100, y: 600 }], closed: true, fill: { color: 'FF0000' }, stroke: { color: '202020', width: 1 } },
    { type: 'table', name: 'budget', position: { x: 500, y: 400 }, size: { width: 300, height: 120 }, columns: [{ runs: [{ text: '项目' }] }, { runs: [{ text: '金额' }] }], rows: [[{ runs: [{ text: '研发' }] }, { runs: [{ text: '100' }] }]], font: { family: 'Arial', size: 24 } },
    { type: 'chart', name: 'sales', position: { x: 900, y: 350 }, size: { width: 300, height: 240 }, chart_type: 'bar', categories: ['A', 'B'], series: [{ name: '销量', values: [10, 20] }] },
  );
  const bytes = await exportPresentationPptx(normalizePresentation(deck), 'Native objects');
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  expect(xml).toContain('可编辑标题'); expect(xml).toContain('sz="4200"');
  expect(xml).toContain('<a:custGeom>'); expect(xml).toContain('<a:tbl>'); expect(xml).toContain('<c:chart');
  expect(xml).not.toContain('<p:pic>');
  expect(Object.keys(zip.files).some((name) => name.startsWith('ppt/charts/chart'))).toBe(true);
});
it('rejects unsupported conversions rather than silently dropping the element', async () => {
  const deck = createPresentation(); deck.slides[0].layout.elements!.push({ type: 'infographic', name: 'unsupported', position: { x: 0, y: 0 }, size: { width: 100, height: 100 } });
  await expect(exportPresentationPptx(deck, 'fail closed')).rejects.toThrow('暂不能准确导出');
});
it('matches contain/cover placement and writes original source crop percentages', async () => {
  expect(presentationImagePlacement(4, 4, 200, 100, 'contain')).toMatchObject({ x: 0, y: 1, width: 4, height: 2 });
  expect(presentationImagePlacement(4, 4, 200, 100, 'cover')).toMatchObject({ x: 0, y: 0, width: 4, height: 4, crop: { l: 25, r: 25, t: 0, b: 0 } });
  const deck = createPresentation('Cropped image');
  deck.slides[0].layout.elements!.push({ type: 'image', name: 'cropped', position: { x: 100, y: 100 }, size: { width: 200, height: 200 }, data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1cAAAAASUVORK5CYII=', fit: 'fill', source_crop: { l: 25, r: 25, t: 10, b: 10 } });
  const zip = await JSZip.loadAsync(await exportPresentationPptx(deck, 'Crop'));
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  expect(xml).toContain('<a:srcRect l="25000" r="25000" t="10000" b="10000"/>');
});
it('exports the same sampled rounded/curved vector geometry used by the editor', async () => {
  const deck = createPresentation('Curve');
  deck.slides[0].layout.elements!.push({ type: 'vector', name: 'rounded', points: [{ x: 100, y: 400 }, { x: 300, y: 400 }, { x: 300, y: 500 }, { x: 100, y: 500 }], closed: true, corner_radii: [20, 20, 20, 20], fill: { color: '00AA66' } });
  const zip = await JSZip.loadAsync(await exportPresentationPptx(deck, 'Rounded'));
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  expect((xml.match(/<a:lnTo>/g) ?? []).length).toBeGreaterThan(4);
});
