/** Which files the knowledge base can take, and why the others are turned away. */

/** Read on the server (Word / Excel / PowerPoint / PDF): the browser cannot turn these into text. */
export const OFFICE_FILE = /\.(docx|xlsx|pptx|pdf)$/i;
const UNSUPPORTED = /\.(doc|xls|ppt|png|jpe?g|gif|webp|bmp|zip|rar|7z|exe|dmg|mp[34]|mov|avi)$/i;

export const KNOWLEDGE_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const KNOWLEDGE_MAX_OFFICE_BYTES = 25 * 1024 * 1024;

export function knowledgeFileProblem(file: { name: string; size: number }): string | null {
  if (UNSUPPORTED.test(file.name)) return `「${file.name}」暂不支持直接导入（旧版 Office、图片），请先另存为 .txt / .md，或把旧版 Office 另存为 docx / xlsx / pptx`;
  const limit = OFFICE_FILE.test(file.name) ? KNOWLEDGE_MAX_OFFICE_BYTES : KNOWLEDGE_MAX_FILE_BYTES;
  if (file.size > limit) return `「${file.name}」超过 ${limit / 1024 / 1024} MB`;
  if (file.size === 0) return `「${file.name}」是空文件`;
  return null;
}

/** Text that decoded as UTF-8 but is really binary shows up as NUL characters or a flood of replacement characters. */
export function looksBinary(text: string): boolean {
  if (text.includes(String.fromCharCode(0))) return true;
  const sample = text.slice(0, 4000);
  const bad = (sample.match(/�/g) ?? []).length;
  return sample.length > 0 && bad / sample.length > 0.05;
}

const FOLDER_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|html?|xml|ya?ml|log|rst|docx|xlsx|pptx|pdf)$/i;
const SKIPPED_FOLDERS = new Set(['node_modules', '__macosx', 'dist', 'build', 'out', 'target', 'vendor']);
export const KNOWLEDGE_MAX_FOLDER_FILES = 200;

/**
 * Which files of a chosen folder to import: documents only (no hidden files, Office lock files, build or dependency
 * folders), at most 200. Paths keep their folder names so two `README.md` files stay apart.
 */
export function pickFolderFiles<T extends { path: string; size: number }>(entries: readonly T[]): { picked: T[]; skipped: number; truncated: boolean } {
  const wanted = entries.filter((entry) => {
    const parts = entry.path.split(/[\\/]/).filter(Boolean);
    const name = parts[parts.length - 1] ?? '';
    if (parts.some((part) => part.startsWith('.') && part.length > 1) || name.startsWith('~$')) return false;
    if (parts.slice(0, -1).some((part) => SKIPPED_FOLDERS.has(part.toLowerCase()))) return false;
    return FOLDER_EXTENSIONS.test(name) && entry.size > 0;
  });
  return { picked: wanted.slice(0, KNOWLEDGE_MAX_FOLDER_FILES), skipped: entries.length - wanted.length, truncated: wanted.length > KNOWLEDGE_MAX_FOLDER_FILES };
}
