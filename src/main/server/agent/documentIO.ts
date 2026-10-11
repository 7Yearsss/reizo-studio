import { generateHTML, generateJSON } from '@tiptap/html/server';
import mammoth from 'mammoth';
import HTMLtoDOCX from '@turbodocx/html-to-docx';
import { createDocumentContent, documentExtensions, documentSchema, type DocumentContent } from '../../../shared/documentContent';
import { importDocxFidelity } from './docx/import';
import { exportDocxFromOriginal, type ExportOptions } from './docx/export';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MAX_DOCX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function documentFromHtml(html: string): DocumentContent {
  if (Buffer.byteLength(html) > 3_500_000) throw new Error('文档内容过大');
  return createDocumentContent(generateJSON(html, documentExtensions()));
}

/** Style-preserving import; falls back to semantic-only conversion if the file cannot be read structurally. */
export async function importDocx(bytes: Buffer): Promise<DocumentContent> {
  try { return await importDocxFidelity(bytes); }
  catch (error) {
    console.warn('[documents] fidelity import failed, using semantic conversion', error);
    const result = await mammoth.convertToHtml({ buffer: bytes });
    return { ...documentFromHtml(result.value), importWarnings: [
      '该文件无法按原样式导入，已转换为可编辑文档，字体、颜色、对齐等样式可能丢失；原始文件另行保留。',
      ...result.messages.map((message) => message.message).slice(0, 19),
    ] };
  }
}

/**
 * With the original DOCX available, untouched content is copied byte-for-byte and only edited blocks are rewritten.
 * Without it (documents created in-app) the document is rendered from scratch.
 */
export async function exportDocx(content: DocumentContent, original?: Buffer | Uint8Array, options: ExportOptions = {}): Promise<Uint8Array> {
  // Never let a document trigger arbitrary network requests during server-side export.
  documentSchema.nodeFromJSON(content.doc).descendants((node) => {
    if (node.type.name === 'image' && !String(node.attrs.src).startsWith('data:')) throw new Error('导出前请将远程图片替换为内嵌图片');
  });
  if (original && content.docx) {
    try { return await exportDocxFromOriginal(content, original, options); }
    catch (error) { console.warn('[documents] patching original failed, rendering from scratch', error); }
  }
  const html = generateHTML(content.doc, documentExtensions());
  const result = await HTMLtoDOCX(html, null, { title: 'Document', font: content.docx?.typography?.fontFamily?.split(',')[0] ?? 'Arial', fontSize: Math.round((content.docx?.typography?.fontSize ?? 11) * 2) });
  return result instanceof Blob ? new Uint8Array(await result.arrayBuffer()) : new Uint8Array(result as ArrayBuffer);
}
