/** Which files the knowledge base can take, and why the others are turned away. */

/** Read on the server (Word / Excel / PowerPoint): the browser cannot turn these into text. */
export const OFFICE_FILE = /\.(docx|xlsx|pptx)$/i;
const UNSUPPORTED = /\.(pdf|doc|xls|ppt|png|jpe?g|gif|webp|bmp|zip|rar|7z|exe|dmg|mp[34]|mov|avi)$/i;

export const KNOWLEDGE_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const KNOWLEDGE_MAX_OFFICE_BYTES = 25 * 1024 * 1024;

export function knowledgeFileProblem(file: { name: string; size: number }): string | null {
  if (UNSUPPORTED.test(file.name)) return `「${file.name}」暂不支持直接导入（PDF、旧版 Office、图片），请先另存为 .txt / .md，或把旧版 Office 另存为 docx / xlsx / pptx`;
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
