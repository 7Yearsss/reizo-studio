/** Which files the knowledge base can read as plain text today, and why the others are turned away. */
const UNSUPPORTED = /\.(pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|bmp|zip|rar|7z|exe|dmg|mp[34]|mov|avi)$/i;

export const KNOWLEDGE_MAX_FILE_BYTES = 5 * 1024 * 1024;

export function knowledgeFileProblem(file: { name: string; size: number }): string | null {
  if (UNSUPPORTED.test(file.name)) return `「${file.name}」暂不支持直接导入（PDF / Word / Excel / 图片），请先另存为 .txt 或 .md`;
  if (file.size > KNOWLEDGE_MAX_FILE_BYTES) return `「${file.name}」超过 ${KNOWLEDGE_MAX_FILE_BYTES / 1024 / 1024} MB`;
  if (file.size === 0) return `「${file.name}」是空文件`;
  return null;
}

/** Text that decoded as UTF-8 but is really binary shows up as NUL characters or a flood of replacement characters. */
export function looksBinary(text: string): boolean {
  if (text.includes('\u0000')) return true;
  const sample = text.slice(0, 4000);
  const bad = (sample.match(/�/g) ?? []).length;
  return sample.length > 0 && bad / sample.length > 0.05;
}
