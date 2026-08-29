import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import {
  inferArtifactKind,
  mimeForKind,
  type Artifact,
  type ArtifactSource,
  type ArtifactWithContent,
} from '../../../shared/artifact';

const MAX_CONTENT_CHARS = 200_000;

export function createArtifactStore(root: string) {
  const dir = path.join(root, 'artifacts');

  async function ensureDir(): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  function filePath(id: string): string {
    return path.join(dir, `${id}.json`);
  }

  async function readOne(id: string): Promise<ArtifactWithContent | null> {
    try {
      const raw = await readFile(filePath(id), 'utf8');
      return JSON.parse(raw) as ArtifactWithContent;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async function writeOne(artifact: ArtifactWithContent): Promise<void> {
    await ensureDir();
    await writeFile(filePath(artifact.id), JSON.stringify(artifact, null, 2), 'utf8');
  }

  function toMeta(item: ArtifactWithContent): Artifact {
    return {
      id: item.id,
      sessionId: item.sessionId,
      projectId: item.projectId,
      name: item.name,
      kind: item.kind,
      mimeType: item.mimeType,
      source: item.source,
      createdAt: item.createdAt,
    };
  }

  return {
    async listAll(): Promise<Artifact[]> {
      await ensureDir();
      const files = await readdir(dir);
      const items = await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f) => JSON.parse(await readFile(path.join(dir, f), 'utf8')) as ArtifactWithContent),
      );
      return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(toMeta);
    },

    async listBySession(sessionId: string): Promise<Artifact[]> {
      await ensureDir();
      const files = await readdir(dir);
      const items = await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f) => {
            const raw = await readFile(path.join(dir, f), 'utf8');
            return JSON.parse(raw) as ArtifactWithContent;
          }),
      );
      return items
        .filter((item) => item.sessionId === sessionId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(toMeta);
    },

    async get(id: string): Promise<ArtifactWithContent | null> {
      return readOne(id);
    },

    async create(input: {
      sessionId: string;
      projectId?: string | null;
      name: string;
      content: string;
      source: ArtifactSource;
      mimeType?: string;
    }): Promise<ArtifactWithContent> {
      const kind = inferArtifactKind(input.name, input.mimeType);
      const artifact: ArtifactWithContent = {
        id: nanoid(),
        sessionId: input.sessionId,
        projectId: input.projectId ?? null,
        name: input.name,
        kind,
        mimeType: input.mimeType || mimeForKind(kind),
        source: input.source,
        createdAt: new Date().toISOString(),
        content: input.content.slice(0, MAX_CONTENT_CHARS),
      };
      await writeOne(artifact);
      return artifact;
    },

    async remove(id: string): Promise<void> {
      await rm(filePath(id), { force: true });
    },

    async removeBySession(sessionId: string): Promise<void> {
      await ensureDir();
      const files = await readdir(dir);
      await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f) => {
            const raw = await readFile(path.join(dir, f), 'utf8');
            const item = JSON.parse(raw) as ArtifactWithContent;
            if (item.sessionId === sessionId) {
              await rm(filePath(item.id), { force: true });
            }
          }),
      );
    },
  };
}

export type ArtifactStore = ReturnType<typeof createArtifactStore>;
