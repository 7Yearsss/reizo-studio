export type ArtifactKind =
  | 'markdown'
  | 'html'
  | 'text'
  | 'json'
  | 'image'
  | 'binary'
  | 'svg'
  | 'diagram'
  | 'code'
  | 'video'
  | 'audio'
  | 'sketch'
  | 'sheet';

/** Which preview component renders this artifact. */
export type ArtifactRenderer =
  | 'markdown'
  | 'html'
  | 'image'
  | 'video'
  | 'audio'
  | 'code'
  | 'svg'
  | 'diagram'
  | 'sketch'
  | 'sheet'
  | 'raw';

export type ArtifactStatus = 'streaming' | 'complete' | 'error';

export type ArtifactSource = 'attachment' | 'generated' | 'manual';

export type ArtifactOriginSurface =
  | 'chat'
  | 'canvas'
  | 'manual_edit'
  | 'attachment'
  | 'schedule';

/** Who / what produced a given version. */
export interface ArtifactOrigin {
  surface: ArtifactOriginSurface;
  /** The user text / prompt that caused this version, if any. */
  prompt?: string;
  turnId?: string;
  canvasNodeId?: string;
  model?: string;
}

export interface Artifact {
  id: string;
  sessionId: string;
  projectId?: string | null;
  name: string;
  kind: ArtifactKind;
  renderer: ArtifactRenderer;
  status: ArtifactStatus;
  mimeType: string;
  source: ArtifactSource;
  /** 1-based number of the current (latest) version. */
  version: number;
  /** How many versions exist. `> 1` means the version rail is worth showing. */
  versionCount: number;
  /** Real byte size of the current version (blob file size or utf8 length). */
  byteSize: number;
  origin?: ArtifactOrigin;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactWithContent extends Artifact {
  /** Inline text content. Empty string for blob-backed artifacts. */
  content: string;
  /**
   * For blob-backed artifacts (images, video, audio, binary): an absolute
   * `http://127.0.0.1:<port>/api/artifacts/:id/raw?v=<n>` URL the renderer can
   * put straight into `<img src>` / `<video src>`.
   */
  rawUrl?: string;
}

export interface ArtifactVersion {
  n: number;
  /** Display label: `AI edit` | `Manual edit` | `Restored from v3` | `Attachment`. */
  label: string;
  origin: ArtifactOrigin;
  byteSize: number;
  /** sha-256 hex of the version content, for "on-screen still matches" checks. */
  contentDigest: string;
  createdAt: string;
}

const TEXT_KINDS: ReadonlySet<ArtifactKind> = new Set([
  'markdown',
  'html',
  'text',
  'json',
  'svg',
  'diagram',
  'sketch',
  'sheet',
  'code',
]);

/** Blob-backed kinds live as files on disk, not inline in the row. */
export function isBlobKind(kind: ArtifactKind): boolean {
  return !TEXT_KINDS.has(kind);
}

export function inferArtifactKind(name: string, mimeType?: string): ArtifactKind {
  const lower = name.toLowerCase();
  if ((mimeType && mimeType.startsWith('image/')) || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(lower)) {
    return 'image';
  }
  if (mimeType === 'image/svg+xml' || /\.svg$/i.test(lower)) return 'svg';
  if ((mimeType && mimeType.startsWith('video/')) || /\.(mp4|webm|mov|m4v)$/i.test(lower)) return 'video';
  if ((mimeType && mimeType.startsWith('audio/')) || /\.(mp3|wav|ogg|m4a|flac)$/i.test(lower)) return 'audio';
  if (/\.excalidraw$/i.test(lower)) return 'sketch';
  if (/\.(xlsx|xls|csv)$/i.test(lower) || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mimeType === 'text/csv' || mimeType === 'application/vnd.reizo.sheet+json') {
    return 'sheet';
  }
  if (/\.html?$/i.test(lower) || mimeType === 'text/html') return 'html';
  if (/\.md$/i.test(lower) || mimeType === 'text/markdown') return 'markdown';
  if (/\.json$/i.test(lower) || mimeType === 'application/json') return 'json';
  if (/\.(mmd|mermaid)$/i.test(lower)) return 'diagram';
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|cs|rb|php|sh|sql|css|scss|yaml|yml|toml)$/i.test(lower)) {
    return 'code';
  }
  if (mimeType && !mimeType.startsWith('text/') && mimeType !== 'application/json') return 'binary';
  return 'text';
}

export function inferRenderer(kind: ArtifactKind): ArtifactRenderer {
  switch (kind) {
    case 'markdown':
      return 'markdown';
    case 'html':
      return 'html';
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'svg':
      return 'svg';
    case 'diagram':
      return 'diagram';
    case 'sketch':
      return 'diagram';
    case 'sheet':
      return 'sheet';
    case 'code':
    case 'json':
      return 'code';
    case 'text':
      return 'markdown';
    default:
      return 'raw';
  }
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
    case 'svg':
      return 'image/svg+xml';
    case 'video':
      return 'video/mp4';
    case 'audio':
      return 'audio/mpeg';
    case 'diagram':
      return 'text/vnd.mermaid';
    case 'code':
      return 'text/plain';
    case 'sketch':
      return 'application/json';
    case 'sheet':
      return 'application/vnd.reizo.sheet+json';
    case 'binary':
      return 'application/octet-stream';
    default:
      return 'text/plain';
  }
}

/** Best-effort file extension for a blob path, from the mime type or name. */
export function extForBlob(name: string, mimeType: string): string {
  const fromName = /\.[a-z0-9]{1,5}$/i.exec(name);
  if (fromName) return fromName[0].toLowerCase();
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
  };
  return map[mimeType] ?? '.bin';
}
