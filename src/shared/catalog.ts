import type { McpServerEntry } from './extensionConfig';

/** Wire types for the "Discover" catalogs on the Plugins page. */

export interface CatalogSecretField {
  name: string;
  description?: string;
  required: boolean;
  secret: boolean;
}

/** One MCP server from the official registry, reduced to what an "Add" button needs. */
export interface McpCatalogItem {
  /** Registry name, e.g. "ai.smithery/smithery-ai-github". */
  id: string;
  title: string;
  description: string;
  website?: string;
  version?: string;
  install:
    | { kind: 'remote'; transport: 'http' | 'sse'; url: string; headers: CatalogSecretField[] }
    | { kind: 'npm'; identifier: string; version?: string; env: CatalogSecretField[] };
}

export interface McpCatalogPage {
  items: McpCatalogItem[];
  nextCursor?: string;
}

/** One plugin from a Claude-style marketplace. */
export interface PluginCatalogItem {
  id: string;
  name: string;
  description: string;
  category?: string;
  author?: string;
  homepage?: string;
  /** Where it is hosted, for display ("owner/repo"). */
  repo: string;
}

export interface PluginCatalog {
  marketplace: string;
  items: PluginCatalogItem[];
}

/** Server names are limited to letters, digits and hyphens (24 max) — see mcp.json validation. */
export function suggestServerName(registryId: string): string {
  const last = registryId.split('/').pop() ?? registryId;
  const cleaned = last.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/g, '');
  return cleaned || 'server';
}

/** A ready-to-edit MCP entry for the "Add" button, with the secrets the user still has to fill in. */
export function mcpCatalogDraft(item: McpCatalogItem): { entry: McpServerEntry; fields: CatalogSecretField[] } {
  const name = suggestServerName(item.id);
  if (item.install.kind === 'remote') {
    const headers = item.install.headers;
    return {
      entry: { name, transport: item.install.transport, url: item.install.url, headers: headers.length ? Object.fromEntries(headers.map((h) => [h.name, ''])) : undefined },
      fields: headers,
    };
  }
  const { identifier, version, env } = item.install;
  const sorted = [...env].sort((a, b) => Number(b.required) - Number(a.required));
  return {
    entry: {
      name, transport: 'stdio', command: 'npx', args: ['-y', version ? `${identifier}@${version}` : identifier],
      env: sorted.length ? Object.fromEntries(sorted.map((f) => [f.name, ''])) : undefined,
    },
    fields: sorted,
  };
}
