import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { buildIndex, chunkText, type Chunk, type KnowledgeIndex, type SearchHit } from '../../../shared/knowledgeIndex';
import { redactSecrets } from '../../../shared/redactSecrets';
import { writeTextAtomic } from './atomicFile';

export const KNOWLEDGE_MAX_DOC_CHARS = 2_000_000;
export const KNOWLEDGE_MAX_DOCS = 500;

export interface KnowledgeDoc { id: string; name: string; chars: number; chunks: number; addedAt: string }
interface StoredDoc extends KnowledgeDoc { passages: string[] }
export class KnowledgeError extends Error {}

/**
 * One JSON file per imported document under `<dataRoot>/knowledge`, written atomically (a crash leaves the old state,
 * never a half-written document). The search index is rebuilt in memory when the set of documents changes.
 * Text is passed through the secret redactor before it is stored, so a key inside a document never reaches the index.
 */
function buildKnowledgeStore(dataRoot: string) {
  const dir = path.join(dataRoot, 'knowledge');
  const fileFor = (id: string) => path.join(dir, `${id}.json`);
  let cache: { key: string; index: KnowledgeIndex; names: Map<string, string> } | null = null;

  async function readAll(): Promise<StoredDoc[]> {
    const names = await readdir(dir).catch((): string[] => []);
    const docs: StoredDoc[] = [];
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      try {
        const doc = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as StoredDoc;
        if (typeof doc.id === 'string' && typeof doc.name === 'string' && Array.isArray(doc.passages)) docs.push(doc);
      } catch { /* an unreadable file is skipped, not fatal */ }
    }
    return docs.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  }

  async function indexOf(): Promise<{ index: KnowledgeIndex; names: Map<string, string> }> {
    const docs = await readAll();
    const key = docs.map((d) => `${d.id}:${d.chunks}`).join('|');
    if (cache?.key === key) return cache;
    const chunks: Chunk[] = docs.flatMap((d) => d.passages.map((text, index) => ({ docId: d.id, index, text })));
    cache = { key, index: buildIndex(chunks), names: new Map(docs.map((d) => [d.id, d.name])) };
    return cache;
  }

  return {
    async list(): Promise<KnowledgeDoc[]> {
      return (await readAll()).map(({ passages: _passages, ...doc }) => doc);
    },
    /** Add or replace (same name) a document. */
    async add(input: { name: string; text: string }): Promise<KnowledgeDoc> {
      const name = input.name.trim().slice(0, 200);
      if (!name) throw new KnowledgeError('请给资料起个名字');
      const text = redactSecrets(input.text);
      if (!text.trim()) throw new KnowledgeError('这份资料没有可读的文字内容');
      if (text.length > KNOWLEDGE_MAX_DOC_CHARS) throw new KnowledgeError(`单份资料最多 ${KNOWLEDGE_MAX_DOC_CHARS.toLocaleString()} 字`);
      const existing = await readAll();
      const same = existing.find((d) => d.name === name);
      if (!same && existing.length >= KNOWLEDGE_MAX_DOCS) throw new KnowledgeError(`最多保存 ${KNOWLEDGE_MAX_DOCS} 份资料`);
      const id = same?.id ?? nanoid(10);
      const passages = chunkText(id, text).map((c) => c.text);
      const doc: StoredDoc = { id, name, chars: text.length, chunks: passages.length, addedAt: new Date().toISOString(), passages };
      await mkdir(dir, { recursive: true });
      await writeTextAtomic(fileFor(id), JSON.stringify(doc));
      cache = null;
      const { passages: _p, ...summary } = doc;
      return summary;
    },
    async remove(id: string): Promise<boolean> {
      if (!/^[\w-]{1,32}$/.test(id)) return false;
      const exists = (await readAll()).some((d) => d.id === id);
      if (!exists) return false;
      await rm(fileFor(id), { force: true });
      cache = null;
      return true;
    },
    async search(query: string, limit = 5): Promise<Array<SearchHit & { name: string }>> {
      const { index, names } = await indexOf();
      return index.search(query, limit).map((hit) => ({ ...hit, name: names.get(hit.docId) ?? hit.docId }));
    },
  };
}

export type KnowledgeStore = ReturnType<typeof buildKnowledgeStore>;

const stores = new Map<string, KnowledgeStore>();
/** One store per data folder, so the route and the agent share the same index cache. */
export function createKnowledgeStore(dataRoot: string): KnowledgeStore {
  let store = stores.get(dataRoot);
  if (!store) { store = buildKnowledgeStore(dataRoot); stores.set(dataRoot, store); }
  return store;
}
