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
      node.children = node.children.map(child => {
        if (!inLink && node.type !== 'link' && child.type === 'inlineCode' && child.value) {
          const path = workspaceFilePath(child.value);
          if (path) return { type: 'link', url: workspaceFileHref(path), children: [child] };
        }
        walk(child, inLink || node.type === 'link');
        return child;
      });
    };
    walk(tree);
  };
}
