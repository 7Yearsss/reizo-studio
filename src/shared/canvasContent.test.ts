import { describe, expect, it } from 'vitest';
import {
  mergeCanvasElements,
  needsCanvasConversion,
  parseCanvasContent,
  serializeCanvasContent,
  tagAsMermaidSourced,
} from './canvasContent';

describe('canvasContent', () => {
  it('parses raw Mermaid string into CanvasArtifactContent', () => {
    const raw = 'flowchart TD\nA --> B';
    const parsed = parseCanvasContent(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.mermaidSource).toBe(raw);
    expect(parsed?.scene).toBeUndefined();
  });

  it('parses serialized JSON CanvasArtifactContent', () => {
    const data = {
      mermaidSource: 'flowchart TD\nA --> B',
      convertedFromMermaid: 'flowchart TD\nA --> B',
      scene: {
        elements: [{ id: '1', customData: { source: 'mermaid' } }],
        appState: { viewBackgroundColor: '#ffffff' },
      },
    };
    const serialized = serializeCanvasContent(data);
    const parsed = parseCanvasContent(serialized);
    expect(parsed).toEqual(data);
  });

  it('determines when conversion is needed', () => {
    expect(needsCanvasConversion({ mermaidSource: 'flowchart TD\nA-->B' })).toBe(true);
    expect(
      needsCanvasConversion({
        mermaidSource: 'flowchart TD\nA-->B',
        convertedFromMermaid: 'flowchart TD\nA-->B',
        scene: { elements: [], appState: {} },
      }),
    ).toBe(false);
    expect(
      needsCanvasConversion({
        mermaidSource: 'flowchart TD\nA-->B-->C',
        convertedFromMermaid: 'flowchart TD\nA-->B',
        scene: { elements: [], appState: {} },
      }),
    ).toBe(true);
  });

  it('merges fresh mermaid elements while preserving user-drawn elements', () => {
    const oldElements = [
      { id: 'node-1', customData: { source: 'mermaid' } },
      { id: 'user-note-1', customData: { customNote: 'hello' } },
    ];
    const freshMermaid = [{ id: 'node-1-new' }];

    const merged = mergeCanvasElements(oldElements, freshMermaid);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ id: 'node-1-new', customData: { source: 'mermaid' } });
    expect(merged[1]).toEqual({ id: 'user-note-1', customData: { customNote: 'hello' } });
  });

  it('tags elements as mermaid sourced', () => {
    const tagged = tagAsMermaidSourced([{ id: 'a' }]);
    expect(tagged[0]?.customData?.source).toBe('mermaid');
  });
});
