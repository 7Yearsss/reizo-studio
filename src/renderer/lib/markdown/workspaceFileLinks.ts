const FILE_EXTENSION = /\.(?:md|markdown|mdx|txt|html?|css|js|jsx|ts|tsx|json|jsonc|yaml|yml|toml|xml|csv|py|sh|ps1|sql|png|jpe?g|webp|gif|svg|mp4|webm|mov|mp3|wav|m4a|ogg|pdf|docx|xlsx|pptx|zip)(?::\d+(?::\d+)?)?(?:#L?\d+)?$/i;
const PREFIX = '#workspace-file:';

export function workspaceFilePath(href: string): string | null {
  let value = href.trim();
  let decoded = false;
  if (value.startsWith(PREFIX)) {
    try { value = decodeURIComponent(value.slice(PREFIX.length)); } catch { return null; }
    decoded = true;
  }
  if (/^file:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.hostname && url.hostname !== 'localhost') return null;
      value = decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/i, '$1');
    } catch { return null; }
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[/\\]/i.test(value)) return null;
    if (/^(?:#|\?|\/\/)/.test(value)) return null;
    if (!decoded) { try { value = decodeURIComponent(value); } catch { return null; } }
  }
  if (!FILE_EXTENSION.test(value) || /[\r\n\0]/.test(value)) return null;
  return value.replace(/#L?\d+$/, '').replace(/:\d+(?::\d+)?$/, '').replace(/\\/g, '/');
}

const EXTENSIONS = FILE_EXTENSION.source.slice(FILE_EXTENSION.source.indexOf('(?:') + 3, FILE_EXTENSION.source.indexOf(')'));
// A path-looking run in prose: optional drive/relative prefix, folders, then a name with a known extension.
// The lookbehind keeps it out of URLs, emails and the middle of words; CJK text may sit right next to it.
const BARE_PATH = new RegExp(
  String.raw`(?<![\w/\\.:@#-])((?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?(?:[\w.\-一-龥]+[\\/])*[\w\-一-龥][\w.\-一-龥]*\.(?:${EXTENSIONS}))((?::\d+(?::\d+)?)?)(?![\w])`,
  'gi',
);

/** Split prose into text and workspace-file path segments. */
export function splitBarePaths(text: string): Array<{ text: string; path?: string }> {
  const out: Array<{ text: string; path?: string }> = [];
  let last = 0;
  for (const match of text.matchAll(BARE_PATH)) {
    if (match.index === undefined) continue;
    let raw = match[0];
    let start = match.index;
    // "打开report.pdf": a bare name glued to preceding Chinese prose starts at the first ASCII character.
    if (!/[\\/]/.test(raw)) {
      const lead = /^[一-龥]+(?=[A-Za-z0-9])/.exec(raw);
      if (lead) { raw = raw.slice(lead[0].length); start += lead[0].length; }
    }
    const path = workspaceFilePath(raw);
    if (!path) continue;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: raw, path });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function workspaceFileHref(path: string): string { return `${PREFIX}${encodeURIComponent(path)}`; }

interface MarkdownNode { type: string; value?: string; url?: string; children?: MarkdownNode[] }

/** Rewrite links and inline-code filenames, leaving fenced code and ordinary prose intact. */
export function workspaceFileLinks() {
  return (tree: MarkdownNode) => {
    const walk = (node: MarkdownNode, inLink = false) => {
      if (node.type === 'link' && node.url) {
        const path = workspaceFilePath(node.url);
        if (path) node.url = workspaceFileHref(path);
      }
      if (!node.children) return;
      node.children = node.children.map((child): MarkdownNode | MarkdownNode[] => {
        if (!inLink && node.type !== 'link' && child.type === 'inlineCode' && child.value) {
          const path = workspaceFilePath(child.value);
          if (path) return { type: 'link', url: workspaceFileHref(path), children: [child] };
        }
        if (!inLink && node.type !== 'link' && child.type === 'text' && child.value) {
          const parts = splitBarePaths(child.value);
          if (parts.some((p) => p.path)) {
            return parts.map((p): MarkdownNode => p.path
              ? { type: 'link', url: workspaceFileHref(p.path), children: [{ type: 'text', value: p.text }] }
              : { type: 'text', value: p.text });
          }
        }
        walk(child, inLink || node.type === 'link');
        return child;
      }).flat();
    };
    walk(tree);
  };
}
