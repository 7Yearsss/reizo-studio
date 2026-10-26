import { tool } from 'ai';
import { z } from 'zod';
import { inferArtifactKind, mimeForKind } from '../../../shared/artifact';
import type { ArtifactStore } from '../storage/artifactStore';

const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|json|html?|xml|ts|tsx|js|jsx|py|go|rs|java|c|cpp|cs|rb|php|sh|ps1|sql|css|scss|yaml|yml|toml|ini|log)$/i;

export const FILE_GENERATION_INSTRUCTIONS =
  'When a user asks for a downloadable TXT, Markdown, CSV, JSON, HTML or source-code file, call generate_file with the complete content and a filename including its extension. It stores a real session artifact, automatically opens its preview and provides a download button; no workspace folder is required. Never merely paste the content and tell the user to copy/save it, or claim that files cannot be attached. After the tool succeeds, confirm the created file in one short sentence, adding only material caveats or usage instructions. The UI already shows its card and download action: do not add Markdown download links, repeat the completion notice, or paste the file contents again. Use generate_document/generate_sheet/generate_presentation for Word/Excel/PPT, rather than renaming plain text to a binary format. Use write_file for changes to a specific workspace path.';

export function createFileTools({ sessionId, projectId, artifactStore }: {
  sessionId: string; projectId?: string | null; artifactStore: ArtifactStore;
}) {
  return {
    generate_file: tool({
      description: '生成可直接预览、下载的 UTF-8 文本文件（TXT、Markdown、CSV、JSON、HTML、代码等），保存到本会话作品，无需绑定本地文件夹。用户说“生成一个出师表的 txt”等文件交付请求时直接使用本工具，不能仅粘贴正文让用户自行保存。Word、Excel、PPT 使用各自的专用生成工具。',
      inputSchema: z.object({
        filename: z.string().min(1).max(240).describe('完整文件名及扩展名，例如 出师表.txt、说明.md，不包含目录路径'),
        content: z.string().max(4_000_000).describe('文件完整正文，原样保存为 UTF-8；不是内容摘要，也不加包裹全文的 Markdown 围栏'),
      }),
      execute: async ({ filename, content }) => {
        const name = filename.trim();
        if (!name || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
          return { ok: false, error: '请使用有效的文件名，不要包含文件夹路径或系统保留名称。' };
        if (!TEXT_EXTENSIONS.test(name)) return { ok: false, error: '本工具只生成文本格式文件。请为 PDF、Word、Excel、PPT、图片和视频使用对应的生成/导出工具。' };
        if (Buffer.byteLength(content, 'utf8') > 4_000_000) return { ok: false, error: '文件超过 4 MB，请拆分为多个文件。' };
        if (/\.json$/i.test(name)) {
          try { JSON.parse(content); } catch { return { ok: false, error: 'JSON 语法无效，请修正后再生成。' }; }
        }
        const kind = /\.(csv|txt|xml|ps1|ini|log)$/i.test(name) ? 'text' : /\.markdown$/i.test(name) ? 'markdown' : inferArtifactKind(name);
        const mimeType = /\.csv$/i.test(name) ? 'text/csv' : mimeForKind(kind);
        const artifact = await artifactStore.create({ sessionId, projectId, name, content, kind, mimeType,
          source: 'generated', origin: { surface: 'chat' } });
        return { ok: true, artifactId: artifact.id, name: artifact.name, kind: artifact.kind,
          version: artifact.version, byteSize: artifact.byteSize,
          previewUrl: `#artifact:${artifact.id}`, downloadUrl: `/api/artifacts/${encodeURIComponent(artifact.id)}/download?v=${artifact.version}` };
      },
    }),
  };
}
