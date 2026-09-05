export interface CanvasElement {
  id: string;
  customData?: { source?: string } & Record<string, unknown>;
  [key: string]: unknown;
}

export interface CanvasArtifactContent {
  mermaidSource: string;
  /** Mermaid source from which the current scene was generated. */
  convertedFromMermaid?: string;
  scene?: {
    elements: CanvasElement[];
    appState: Record<string, unknown>;
  };
}

/**
 * Excalidraw keeps live collaboration state in a Map. JSON turns that Map
 * into `{}`, which then crashes Excalidraw when it expects `.forEach()`.
 */
export function sanitizeCanvasAppState(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const source = value as Record<string, unknown>;
  const appState: Record<string, unknown> = {};

  if (typeof source.viewBackgroundColor === 'string') {
    appState.viewBackgroundColor = source.viewBackgroundColor;
  }
  if (typeof source.gridSize === 'number' && Number.isFinite(source.gridSize)) {
    appState.gridSize = source.gridSize;
  }
  if (typeof source.gridModeEnabled === 'boolean') {
    appState.gridModeEnabled = source.gridModeEnabled;
  }
  if (
    typeof source.zoom === 'object' &&
    source.zoom !== null &&
    !Array.isArray(source.zoom) &&
    typeof (source.zoom as { value?: unknown }).value === 'number' &&
    Number.isFinite((source.zoom as { value: number }).value) &&
    (source.zoom as { value: number }).value > 0
  ) {
    appState.zoom = { value: (source.zoom as { value: number }).value };
  }

  return appState;
}

function normalizeCanvasScene(value: unknown): CanvasArtifactContent['scene'] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const scene = value as { elements?: unknown; appState?: unknown };
  if (!Array.isArray(scene.elements)) return undefined;

  return {
    elements: scene.elements as CanvasElement[],
    appState: sanitizeCanvasAppState(scene.appState),
  };
}

export function serializeCanvasContent(content: CanvasArtifactContent): string {
  return JSON.stringify({
    ...content,
    scene: content.scene
      ? {
          ...content.scene,
          appState: sanitizeCanvasAppState(content.scene.appState),
        }
      : undefined,
  });
}

export function parseCanvasContent(raw: string): CanvasArtifactContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // If the content is raw Mermaid code (not JSON), wrap it as a fresh CanvasArtifactContent!
    if (typeof raw === 'string' && raw.trim()) {
      return { mermaidSource: raw.trim() };
    }
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { mermaidSource?: unknown }).mermaidSource !== 'string'
  ) {
    return null;
  }

  const content = parsed as CanvasArtifactContent;
  return {
    ...content,
    scene: normalizeCanvasScene(content.scene),
  };
}

export function needsCanvasConversion(content: CanvasArtifactContent): boolean {
  return !content.scene || content.convertedFromMermaid !== content.mermaidSource;
}

export function tagAsMermaidSourced(elements: CanvasElement[]): CanvasElement[] {
  return elements.map((element) => ({
    ...element,
    customData: { ...(element.customData ?? {}), source: 'mermaid' },
  }));
}

export function mergeCanvasElements(
  oldElements: CanvasElement[],
  freshMermaidElements: CanvasElement[],
): CanvasElement[] {
  const userDrawn = oldElements.filter((element) => element.customData?.source !== 'mermaid');
  return [...tagAsMermaidSourced(freshMermaidElements), ...userDrawn];
}
