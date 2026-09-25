import { tool } from 'ai';
import { z } from 'zod';
import type { ScheduleStore } from '../storage/scheduleStore';

/** Floor for recurring intervals — below this a schedule is a cost footgun. */
export const MIN_INTERVAL_MS = 60_000;

export function createScheduleTools(options: { scheduleStore: ScheduleStore }) {
  const { scheduleStore } = options;

  return {
    create_schedule: tool({
      description:
        'Create an automation that runs a prompt as a new session on a timer. Set once:true for a one-shot reminder ("check on this in 30 minutes"); otherwise it recurs every intervalMinutes (min 1). The user can review and delete it under 自动化.',
      inputSchema: z.object({
        prompt: z.string().describe('The instruction to run when the schedule fires.'),
        intervalMinutes: z
          .number()
          .describe('Minutes between runs. For once:true schedules this is the delay before the single run.'),
        name: z.string().optional().describe('Short label shown in the automation list. Defaults to the prompt start.'),
        once: z.boolean().optional().describe('If true, runs exactly once then removes itself.'),
      }),
      execute: async ({ prompt, intervalMinutes, name, once }) => {
        const intervalMs = Math.max(Math.round(intervalMinutes * 60_000), MIN_INTERVAL_MS);
        const schedule = await scheduleStore.create({
          name: (name ?? prompt).slice(0, 60),
          prompt,
          intervalMs,
          once: once === true,
        });
        return { ok: true, schedule };
      },
    }),

    list_schedules: tool({
      description: 'List all automations (schedules) with their prompt, interval, next run time, and enabled state.',
      inputSchema: z.object({}),
      execute: async () => {
        return { schedules: await scheduleStore.list() };
      },
    }),

    delete_schedule: tool({
      description: 'Delete an automation by id (from list_schedules).',
      inputSchema: z.object({
        id: z.string().describe('The schedule id to delete.'),
      }),
      execute: async ({ id }) => {
        await scheduleStore.remove(id);
        return { ok: true, id };
      },
    }),
  };
}
