import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { createDocumentContent, documentBlocks, documentSchema, documentSelectionBetween } from '../../../shared/documentContent';
import { wrapDocumentContext, splitDocumentContext } from '../../../shared/documentReferences';
import { buildDocumentContext } from './documentContext';

async function fixture(paragraphs: string[]) {
  const store = createArtifactStore(openDb(':memory:'), mkdtempSync(path.join(tmpdir(), 'reizo-docctx-')));
  const content = createDocumentContent({ type: 'doc', content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
  const artifact = await store.create({ sessionId: 's1', kind: 'doc', name: '方案.docx', source: 'generated', content: JSON.stringify(content) });
  return { store, artifact, content, doc: documentSchema.nodeFromJSON(content.doc) };
}

describe('buildDocumentContext', () => {
  it('hands the agent a picked range with exact block ids, offsets and text so it can edit without reading', async () => {
    const { store, artifact, content, doc } = await fixture(['项目预计十月上线，团队保持不变。', '第二段内容。']);
    const [first] = documentBlocks(content);
    const selection = documentSelectionBetween(doc, 1 + 4, 1 + 6)!;
    const text = await buildDocumentContext(store, 's1', [{ artifactId: artifact.id, name: artifact.name, version: artifact.version, selection, label: 1 }]);
    expect(text).toContain(`version=${artifact.version}`);
    expect(text).toContain(`block ${first.id} chars 4-6`);
    expect(text).toContain('"十月"');
    expect(text).toContain('full paragraph: "项目预计十月上线，团队保持不变。"');
    expect(text).not.toContain('第二段内容');
  });

  it('describes a range across paragraphs block by block', async () => {
    const { store, artifact, doc } = await fixture(['甲乙丙丁', '戊己庚辛', '壬癸子丑']);
    const third = doc.child(0).nodeSize + doc.child(1).nodeSize;
    const selection = documentSelectionBetween(doc, 1 + 2, third + 1 + 2)!;
    const text = await buildDocumentContext(store, 's1', [{ artifactId: artifact.id, name: artifact.name, selection, label: 1 }]);
    expect(text).toContain('across 3 blocks');
    expect(text).toContain('(whole block)');
    expect(text).toContain('"戊己庚辛"');
  });

  it('inlines a small document for a whole-document reference and skips other sessions', async () => {
    const { store, artifact } = await fixture(['第一段', '第二段']);
    const text = await buildDocumentContext(store, 's1', [{ artifactId: artifact.id, name: artifact.name }]);
    expect(text).toContain('whole document:');
    expect(text).toContain('"第二段"');
    expect(await buildDocumentContext(store, 'other', [{ artifactId: artifact.id, name: artifact.name }])).toBe('');
  });

  it('is carried in the wrapped context without breaking reference parsing', async () => {
    const { artifact } = await fixture(['x']);
    const wrapped = wrapDocumentContext([{ artifactId: artifact.id, name: 'n' }], 'Document "n" version=1');
    expect(wrapped).toContain('"current"');
    expect(splitDocumentContext(`hi\n\n${wrapped}`).refs).toHaveLength(1);
  });
});
