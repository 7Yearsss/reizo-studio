import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { createPresentation, presentationElements } from '../../../shared/presentationContent';
import { wrapHtmlContext, splitHtmlContext } from '../../../shared/htmlReferences';
import { wrapPresentationContext, splitPresentationContext } from '../../../shared/presentationReferences';
import { buildPresentationContext } from './presentationContext';
import { buildHtmlContext } from './htmlContext';

const handles: ReturnType<typeof openDb>[] = [];
afterEach(() => handles.splice(0).forEach((db) => db.close()));
function store() {
  const db = openDb(':memory:'); handles.push(db);
  return createArtifactStore(db, mkdtempSync(path.join(tmpdir(), 'ctx-')));
}

describe('buildPresentationContext', () => {
  it('gives the agent the picked elements with ids, frames, fonts and words so it can edit without reading', async () => {
    const artifacts = store();
    const deck = createPresentation('原标题');
    const artifact = await artifacts.create({ sessionId: 's', name: '汇报', kind: 'presentation', source: 'manual', content: JSON.stringify(deck) });
    const [title, body] = presentationElements(deck.slides[0]);
    const picked = await buildPresentationContext(artifacts, 's', [{ artifactId: artifact.id, name: '汇报', version: artifact.version, slideId: deck.slides[0].id, elementIds: [title.element.id!] }]);
    expect(picked).toContain(`version=${artifact.version}`);
    expect(picked).toContain('selected elements:');
    expect(picked).toContain(title.element.id!);
    expect(picked).toContain('原标题');
    expect(picked).toMatch(/@\(\d+,\d+\) \d+x\d+/);
    expect(picked).not.toContain(body.element.id!); // only what was picked
    const whole = await buildPresentationContext(artifacts, 's', [{ artifactId: artifact.id, name: '汇报', version: artifact.version }]);
    expect(whole).toContain(body.element.id!);
    expect(await buildPresentationContext(artifacts, 'other', [{ artifactId: artifact.id, name: '汇报', version: 1 }])).toBe('');
  });
  it('is carried in the wrapped context without breaking reference parsing', () => {
    const wrapped = wrapPresentationContext([{ artifactId: 'a1', name: 'n', version: 1 }], 'Deck "n" version=1');
    expect(wrapped).toContain('"current"');
    expect(splitPresentationContext(`hi\n\n${wrapped}`).refs).toHaveLength(1);
  });
});

describe('buildHtmlContext', () => {
  const html = '<!doctype html>\n<html>\n<body>\n<h1>欢迎使用</h1>\n<p>这是一个很普通的段落。</p>\n</body>\n</html>';
  it('shows each picked range with its lines and the source around it, and notices a range that moved', async () => {
    const artifacts = store();
    const artifact = await artifacts.create({ sessionId: 's', name: '页面.html', kind: 'html', source: 'manual', content: html });
    const start = html.indexOf('欢迎使用');
    const text = await buildHtmlContext(artifacts, 's', [{ artifactId: artifact.id, name: '页面.html', version: artifact.version, label: 1, selection: { start, end: start + 4, text: '欢迎使用' } }]);
    expect(text).toContain(`version=${artifact.version}`);
    expect(text).toContain('[1] selected source');
    expect(text).toContain('<<<\n欢迎使用\n>>>');
    expect(text).toContain('lines 4-4');
    expect(text).toContain('<h1>');
    const moved = await buildHtmlContext(artifacts, 's', [{ artifactId: artifact.id, name: '页面.html', version: 1, selection: { start, end: start + 4, text: '再见了朋友' } }]);
    expect(moved).toContain('has changed since it was picked');
  });
  it('inlines a small page for a whole-page reference, and survives the wrapper', async () => {
    const artifacts = store();
    const artifact = await artifacts.create({ sessionId: 's', name: '页面.html', kind: 'html', source: 'manual', content: html });
    const text = await buildHtmlContext(artifacts, 's', [{ artifactId: artifact.id, name: '页面.html', version: 1 }]);
    expect(text).toContain('whole page source:');
    expect(text).toContain('<p>这是一个很普通的段落。</p>');
    const wrapped = wrapHtmlContext([{ artifactId: artifact.id, name: 'n', version: 1 }], text);
    expect(splitHtmlContext(`hi\n\n${wrapped}`).refs).toHaveLength(1);
  });
});
