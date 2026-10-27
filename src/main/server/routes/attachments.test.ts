import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createAttachmentsRouter } from './attachments';

const post = (name: string, body: BodyInit) => createAttachmentsRouter().request(`/extract?name=${encodeURIComponent(name)}`, { method: 'POST', body });

describe('POST /extract', () => {
  it('returns the text of a pptx and refuses what it cannot read, saying why', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', '<p:sld><a:t>季度复盘</a:t></p:sld>');
    const ok = await post('复盘.pptx', await zip.generateAsync({ type: 'uint8array' }) as unknown as BodyInit);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { text: string }).text).toContain('季度复盘');

    const bad = await post('旧.doc', new Uint8Array([1, 2]) as unknown as BodyInit);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain('另存为');
    expect((await post('', 'x')).status).toBe(400);
  });
});
