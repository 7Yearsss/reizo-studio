export type WorkspacePreview =
  | { kind: 'text'; path: string; content: string; truncated: boolean }
  | { kind: 'image' | 'video' | 'audio' | 'unsupported'; path: string };

export const PREVIEW_MEDIA: Record<string, { kind: 'image' | 'video' | 'audio'; mime: string }> = {
  png: { kind: 'image', mime: 'image/png' }, jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' }, webp: { kind: 'image', mime: 'image/webp' },
  gif: { kind: 'image', mime: 'image/gif' }, svg: { kind: 'image', mime: 'image/svg+xml' },
  mp4: { kind: 'video', mime: 'video/mp4' }, webm: { kind: 'video', mime: 'video/webm' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  mp3: { kind: 'audio', mime: 'audio/mpeg' }, wav: { kind: 'audio', mime: 'audio/wav' },
  m4a: { kind: 'audio', mime: 'audio/mp4' }, ogg: { kind: 'audio', mime: 'audio/ogg' },
};

export function previewMedia(extension: string) {
  return Object.hasOwn(PREVIEW_MEDIA, extension) ? PREVIEW_MEDIA[extension] : undefined;
}
