export type ArtifactKind = 'markdown' | 'html' | 'text' | 'json' | 'image' | 'binary';
export type ArtifactSource = 'attachment' | 'generated';

export interface Artifact {
  id: string;
  sessionId: string;
  projectId?: string | null;
  name: string;
  kind: ArtifactKind;
  mimeType: string;
  source: ArtifactSource;
  createdAt: string;
}

export interface ArtifactWithContent extends Artifact {
  content: string;
}

export function inferArtifactKind(name: string, mimeType?: string): ArtifactKind {
  const lower = name.toLowerCase();
  if ((mimeType && mimeType.startsWith('image/')) || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(lower)) {
    return 'image';
  }
  if (/\.html?$/i.test(lower) || mimeType === 'text/html') return 'html';
  if (/\.md$/i.test(lower) || mimeType === 'text/markdown') return 'markdown';
  if (/\.json$/i.test(lower) || mimeType === 'application/json') return 'json';
  if (mimeType && !mimeType.startsWith('text/') && mimeType !== 'application/json') return 'binary';
  return 'text';
}

export function mimeForKind(kind: ArtifactKind): string {
  switch (kind) {
    case 'markdown':
      return 'text/markdown';
    case 'html':
      return 'text/html';
    case 'json':
      return 'application/json';
    case 'image':
      return 'image/png';
    case 'binary':
      return 'application/octet-stream';
    default:
      return 'text/plain';
  }
}
