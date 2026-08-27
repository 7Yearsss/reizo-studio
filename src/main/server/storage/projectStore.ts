import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Project, ProjectPatch } from '../../../shared/project';

export function createProjectStore(root: string) {
  const dir = path.join(root, 'projects');

  async function ensureDir(): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  function filePath(id: string): string {
    return path.join(dir, `${id}.json`);
  }

  async function readProject(id: string): Promise<Project | null> {
    try {
      const raw = await readFile(filePath(id), 'utf8');
      return JSON.parse(raw) as Project;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async function writeProject(project: Project): Promise<void> {
    await ensureDir();
    await writeFile(filePath(project.id), JSON.stringify(project, null, 2), 'utf8');
  }

  return {
    async list(): Promise<Project[]> {
      await ensureDir();
      const files = await readdir(dir);
      const projects = await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f) => {
            const raw = await readFile(path.join(dir, f), 'utf8');
            return JSON.parse(raw) as Project;
          }),
      );
      return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async get(id: string): Promise<Project | null> {
      return readProject(id);
    },

    async create(input: { name: string; description?: string; instructions?: string }): Promise<Project> {
      const now = new Date().toISOString();
      const project: Project = {
        id: nanoid(),
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        instructions: input.instructions?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      };
      await writeProject(project);
      return project;
    },

    async update(id: string, patch: ProjectPatch): Promise<Project> {
      const project = await readProject(id);
      if (!project) throw new Error(`Project not found: ${id}`);
      if (typeof patch.name === 'string' && patch.name.trim()) project.name = patch.name.trim();
      if (patch.description !== undefined) {
        project.description = patch.description?.trim() || undefined;
      }
      if (patch.instructions !== undefined) {
        project.instructions = patch.instructions?.trim() || undefined;
      }
      project.updatedAt = new Date().toISOString();
      await writeProject(project);
      return project;
    },

    async remove(id: string): Promise<void> {
      await rm(filePath(id), { force: true });
    },
  };
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
