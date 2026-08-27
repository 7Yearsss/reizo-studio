import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Schedule, SchedulePatch } from '../../../shared/schedule';

interface Disk {
  schedules: Schedule[];
}

export function createScheduleStore(root: string) {
  const file = path.join(root, 'schedules.json');

  async function read(): Promise<Schedule[]> {
    try {
      const raw = await readFile(file, 'utf8');
      const disk = JSON.parse(raw) as Disk;
      return Array.isArray(disk.schedules) ? disk.schedules : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async function write(schedules: Schedule[]): Promise<void> {
    await mkdir(root, { recursive: true });
    await writeFile(file, JSON.stringify({ schedules }, null, 2), 'utf8');
  }

  return {
    list: read,

    async create(input: { name: string; prompt: string; intervalMs: number; skillId?: string }): Promise<Schedule> {
      const now = Date.now();
      const schedule: Schedule = {
        id: nanoid(),
        name: input.name.trim() || input.prompt.slice(0, 40),
        prompt: input.prompt,
        skillId: input.skillId,
        intervalMs: input.intervalMs,
        enabled: true,
        lastRunAt: null,
        nextRunAt: new Date(now + input.intervalMs).toISOString(),
        lastError: null,
        runCount: 0,
        createdAt: new Date(now).toISOString(),
      };
      const schedules = await read();
      schedules.unshift(schedule);
      await write(schedules);
      return schedule;
    },

    async update(id: string, patch: SchedulePatch): Promise<Schedule | null> {
      const schedules = await read();
      const current = schedules.find((item) => item.id === id);
      if (!current) return null;
      if (patch.name !== undefined) current.name = patch.name;
      if (patch.prompt !== undefined) current.prompt = patch.prompt;
      if (patch.skillId !== undefined) current.skillId = patch.skillId ?? undefined;
      if (patch.intervalMs !== undefined) {
        current.intervalMs = patch.intervalMs;
        current.nextRunAt = new Date(Date.now() + patch.intervalMs).toISOString();
      }
      if (patch.enabled !== undefined) {
        current.enabled = patch.enabled;
        if (patch.enabled && patch.nextRunAt === undefined) {
          current.nextRunAt = new Date(Date.now() + current.intervalMs).toISOString();
        }
      }
      if (patch.nextRunAt) current.nextRunAt = patch.nextRunAt;
      await write(schedules);
      return current;
    },

    async remove(id: string): Promise<void> {
      await write((await read()).filter((item) => item.id !== id));
    },

    async due(now = Date.now()): Promise<Schedule[]> {
      return (await read()).filter((item) => item.enabled && Date.parse(item.nextRunAt) <= now);
    },

    async markRun(id: string, error: string | null): Promise<void> {
      const schedules = await read();
      const current = schedules.find((item) => item.id === id);
      if (!current) return;
      const now = Date.now();
      current.lastRunAt = new Date(now).toISOString();
      current.nextRunAt = new Date(now + current.intervalMs).toISOString();
      current.lastError = error;
      current.runCount += 1;
      await write(schedules);
    },
  };
}

export type ScheduleStore = ReturnType<typeof createScheduleStore>;
