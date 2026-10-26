/** With more MCP tools than this, the model sees a search + call pair instead of every definition. */
export const MCP_META_THRESHOLD = 30;

export interface SearchableTool { name: string; server: string; description: string }

const words = (text: string): string[] => {
  const lower = text.toLowerCase();
  const out: string[] = lower.match(/[a-z0-9]{2,}/g) ?? [];
  for (const run of lower.match(/[一-鿿]+/g) ?? []) for (let i = 0; i + 1 < run.length; i += 1) out.push(run.slice(i, i + 2));
  return out;
};

/**
 * Lightweight ranking by name / server / description (no embeddings): a hit in the name counts most, then the server,
 * then the description. Returns at most `limit` tools with a positive score, best first.
 */
export function searchTools<T extends SearchableTool>(tools: readonly T[], query: string, limit = 8): T[] {
  const terms = [...new Set(words(query))];
  if (terms.length === 0) return [];
  return tools
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const server = tool.server.toLowerCase();
      const description = tool.description.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (name.includes(term)) score += 3;
        if (server.includes(term)) score += 2;
        if (description.includes(term)) score += 1;
      }
      return { tool, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, limit)
    .map((x) => x.tool);
}
