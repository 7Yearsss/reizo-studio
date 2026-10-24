export interface GeneratedReplyFile { artifactId: string; name: string; version?: number }
interface Node { type: string; value?: string; url?: string; children?: Node[] }
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plainText = (node: Node): string => node.value ?? node.children?.map(plainText).join('') ?? '';

/** Presentation only: retain the stored reply, caveats and code, while the real card owns download. */
export function compactFileReply({ files, compactSummaries = true }: { files: GeneratedReplyFile[]; compactSummaries?: boolean }) {
  return (tree: Node) => {
    if (!files.length) return;
    const byId = new Map(files.map(file => [file.artifactId, file]));
    const isCardDownload = (node: Node): boolean => {
      if (node.type !== 'link' || !node.url?.startsWith('/api/artifacts/')) return false;
      const match = /^\/api\/artifacts\/([^/?#]+)\/download(?:\?|$)/.exec(node.url);
      if (!match) return false;
      let id: string;
      try { id = decodeURIComponent(match[1]); } catch { return false; }
      const file = byId.get(id);
      if (!file) return false;
      const version = new URL(node.url, 'http://localhost').searchParams.get('v');
      return version === null || (file.version !== undefined && version === String(file.version));
    };
    const removeCardDownloads = (node: Node) => {
      if (!node.children) return;
      node.children = node.children.filter(child => !isCardDownload(child));
      node.children.forEach(removeCardDownloads);
    };
    removeCardDownloads(tree);
    const seen = new Set<string>();
    tree.children = tree.children?.flatMap(node => {
      if (node.type !== 'paragraph') return [node];
      const text = plainText(node).trim();
      if (!text) return [];
      if (!compactSummaries) return [node];
      // Only a narrow, purely administrative confirmation is rewritten. Notes,
      // explanations, tables, lists, code and links to other outputs stay intact.
      if (node.children?.some(child => !['text', 'strong', 'emphasis'].includes(child.type))) return [node];
      if (/^我来生成[^。！？\n]{0,100}(?:TXT|Markdown|CSV|JSON|HTML|文本)\s*文件[。.]$/i.test(text)
        && files.some(file => { const stem = file.name.replace(/\.[^.]+$/, ''); return stem.length >= 2 && text.includes(stem); })) return [];
      const sentences = text.match(/[^。！？]+[。！？]?/gu) ?? [];
      const matches = sentences.map(sentence => files.find(file => new RegExp(
        `^已生成\\s*[《「“"]?${escapeRegExp(file.name)}[》」”"]?\\s*(?:[，,]\\s*包含[^。！？]{1,100}全文(?:[，,]\\s*可在文件卡片中预览[、，,]下载)?)?[。.!]?$`,
      ).test(sentence.trim())));
      if (!matches.length || matches.some(file => !file)) return [node];
      return matches.flatMap(file => {
        if (!file || seen.has(file.artifactId)) return [];
        seen.add(file.artifactId);
        return [{ type: 'paragraph', children: [
          { type: 'text', value: '已生成 ' },
          { type: 'strong', children: [{ type: 'text', value: file.name }] },
          { type: 'text', value: '，可在文件卡片中预览、下载。' },
        ] }];
      });
    });
  };
}
