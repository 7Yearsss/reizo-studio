import { unzipSync, strFromU8 } from 'fflate';
import JSZip from 'jszip';

/** PptxGenJS 4.0.1 declares one master per slide but writes only master1.
 * Remove that exact dangling declaration from our generated package; other defects fail validation. */
export async function normalizeGeneratedPresentation(bytes: Buffer, pageCount: number): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes);
  const contentTypes = zip.file('[Content_Types].xml');
  if (!contentTypes) throw new Error('PPTX 缺少内容类型清单');
  const xml = await contentTypes.async('string');
  const fixed = xml.replace(/<Override\b[^>]*PartName="\/ppt\/slideMasters\/slideMaster(\d+)\.xml"[^>]*\/>/g, (match, number: string) =>
    !zip.file(`ppt/slideMasters/slideMaster${number}.xml`) ? '' : match);
  if (fixed === xml) { verifyImagePresentation(bytes, pageCount); return bytes; }
  zip.file('[Content_Types].xml', fixed);
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  verifyImagePresentation(output, pageCount); return output;
}
export function verifyImagePresentation(bytes: Buffer, pageCount: number): void {
  const partNames = new Set<string>();
  const entries = unzipSync(bytes, { filter: (entry) => { partNames.add(entry.name); return entry.name.endsWith('.xml') || entry.name.endsWith('.rels'); } });
  const presentation = entries['ppt/presentation.xml'];
  if (!presentation || !entries['[Content_Types].xml']) throw new Error('PPTX 缺少原生演示稿内容');
  for (const override of strFromU8(entries['[Content_Types].xml']).matchAll(/<Override\b[^>]*PartName="([^"]+)"/g)) {
    if (!partNames.has(override[1].replace(/^\//, ''))) throw new Error('PPTX 声明的内容文件缺失');
  }
  const xml = strFromU8(presentation); const size = /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(xml);
  if (!size || Math.abs(Number(size[1]) / Number(size[2]) - 16 / 9) > 0.001) throw new Error('PPTX 画幅不是 16:9');
  const slides = Object.keys(entries).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  if (slides.length !== pageCount || slides.some((name) => (strFromU8(entries[name]).match(/<p:pic>/g) ?? []).length !== 1)) throw new Error('PPTX 页数或图片页结构不符');
  if (Object.keys(entries).some((name) => name.endsWith('.rels') && /TargetMode="External"/.test(strFromU8(entries[name])))) throw new Error('PPTX 包含外部资源引用');
}
