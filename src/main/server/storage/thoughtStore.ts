import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Thought } from '../../../shared/schedule';

interface Disk {
  thoughts: Thought[];
}

export function createThoughtStore(root: string) {
  const file = path.join(root, 'thoughts.json');

  async function read(): Promise<Thought[]> {
    try {
      const raw = await readFile(file, 'utf8');
      const disk = JSON.parse(raw) as Disk;
      return Array.isArray(disk.thoughts) ? disk.thoughts : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async function write(thoughts: Thought[]): Promise<void> {
    await mkdir(root, { recursive: true });
    await writeFile(file, JSON.stringify({ thoughts }, null, 2), 'utf8');
  }

  return {
    list: read,

    async create(content: string, tags: string[] = []): Promise<Thought> {
      const thought: Thought = {
        id: nanoid(),
        content: content.trim(),
        tags,
        createdAt: new Date().toISOString(),
      };
      const thoughts = await read();
      thoughts.unshift(thought);
      await write(thoughts);
      return thought;
    },

    async remove(id: string): Promise<void> {
      await write((await read()).filter((item) => item.id !== id));
    },
  };
}

export type ThoughtStore = ReturnType<typeof createThoughtStore>;
