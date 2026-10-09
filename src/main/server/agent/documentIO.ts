import { generateHTML, generateJSON } from '@tiptap/html/server';
import mammoth from 'mammoth';
import HTMLtoDOCX from '@turbodocx/html-to-docx';
import { createDocumentContent, documentExtensions, documentSchema, type DocumentContent } from '../../../shared/documentContent';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MAX_DOCX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function documentFromHtml(html: string): DocumentContent {
  if (Buffer.byteLength(html) > 3_500_000) throw new Error('文档内容过大');
  return createDocumentContent(generateJSON(html, documentExtensions()));
}

export async function importDocx(bytes: Buffer): Promise<DocumentContent> {
  const result = await mammoth.convertToHtml({ buffer: bytes });
  return { ...documentFromHtml(result.value), importWarnings: [
    '已转换为可编辑文档，原始文件另行保留。复杂排版、页眉页脚和 Word 修订记录可能无法保留。',
    ...result.messages.map((message) => message.message).slice(0, 19),
  ] };
}

export async function exportDocx(content: DocumentContent): Promise<Uint8Array> {
  // Never let a document trigger arbitrary network requests during server-side export.
  documentSchema.nodeFromJSON(content.doc).descendants((node) => {
    if (node.type.name === 'image' && !String(node.attrs.src).startsWith('data:')) throw new Error('导出前请将远程图片替换为内嵌图片');
  });
  const html = generateHTML(content.doc, documentExtensions());
  const result = await HTMLtoDOCX(html, null, { title: 'Document', font: 'Arial', fontSize: 22 });
  return result instanceof Blob ? new Uint8Array(await result.arrayBuffer()) : new Uint8Array(result as ArrayBuffer);
}
