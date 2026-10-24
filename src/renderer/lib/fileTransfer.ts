/** Clipboard screenshots may exist only in items, with no path and an empty files list. */
export function transferredFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (files.length) return files;
  return Array.from(data.items ?? []).flatMap(item => {
    const file = item.kind === 'file' ? item.getAsFile() : null;
    return file ? [file] : [];
  });
}

export function hasTransferredFiles(data: DataTransfer): boolean {
  return Array.from(data.types ?? []).includes('Files') || data.files?.length > 0
    || Array.from(data.items ?? []).some(item => item.kind === 'file');
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(file.name);
}
