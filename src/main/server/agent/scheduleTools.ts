import { tool } from 'ai';
import { z } from 'zod';
import { isValidCadence } from '../../../shared/schedule';
import type { PermissionMode } from '../../../shared/settings';
import type { ScheduleStore } from '../storage/scheduleStore';
import { ApprovalRequiredError, requestPermission } from './permissions';

/** Floor for recurring intervals — below this a schedule is a cost footgun. */
export const MIN_INTERVAL_MS = 60_000;

export function createScheduleTools(options: { scheduleStore: ScheduleStore; sessionId?: string; permissionMode?: PermissionMode; skipApproval?: boolean }) {
  const { scheduleStore } = options;
  /** Creating or deleting an automation always needs the user's go-ahead (see ALWAYS_ASK_TOOLS). */
  async function confirm(name: string, args: Record<string, unknown>, toolCallId: string | undefined): Promise<void> {
    if (options.skipApproval) return;
    if (!options.sessionId || !toolCallId) throw new Error('自动化操作需要用户确认，当前上下文无法发起确认');
    const allowed = await requestPermission({ sessionId: options.sessionId, toolCallId, name, args, mode: options.permissionMode ?? 'ask' });
    if (!allowed) throw new ApprovalRequiredError({ toolCallId, name, args, kind: 'permission' });
  }

  return {
    create_schedule: tool({
      description:
        'Create an automation that runs a prompt as a new session on a timer. Set once:true for a one-shot reminder ("check on this in 30 minutes"); otherwise it recurs every intervalMinutes (min 1). For a wall-clock schedule ("every weekday at 9:00", "Mondays at 8:30") pass cadence instead of intervalMinutes; times are in local time. The user can review and delete it under 自动化.',
      inputSchema: z.object({
        prompt: z.string().describe('The instruction to run when the schedule fires.'),
        intervalMinutes: z
          .number()
          .optional()
          .describe('Minutes between runs. For once:true schedules this is the delay before the single run. Omit when cadence is given.'),
        cadence: z
          .object({
            kind: z.enum(['daily', 'weekdays', 'weekly']),
            hour: z.number().int().min(0).max(23),
            minute: z.number().int().min(0).max(59),
            dayOfWeek: z.number().int().min(0).max(6).optional().describe('0 = Sunday … 6 = Saturday; required for weekly.'),
          })
          .optional()
          .describe('Run at a fixed local time: daily, on weekdays (Mon–Fri) or weekly on one day.'),
        name: z.string().optional().describe('Short label shown in the automation list. Defaults to the prompt start.'),
        once: z.boolean().optional().describe('If true, attempts once then pauses; the result and failure remain in history.'),
      }),
      execute: async ({ prompt, intervalMinutes, cadence, name, once }, toolOptions) => {
        if (!cadence && intervalMinutes === undefined) return { ok: false, error: 'Give either intervalMinutes or cadence.' };
        if (cadence && !isValidCadence(cadence)) return { ok: false, error: 'Invalid cadence (weekly needs dayOfWeek; daily and weekdays must not have one).' };
        await confirm('create_schedule', { prompt, ...(intervalMinutes !== undefined ? { intervalMinutes } : {}), ...(cadence ? { cadence } : {}), ...(name ? { name } : {}), ...(once ? { once } : {}) }, toolOptions?.toolCallId);
        const intervalMs = cadence ? 24 * 60 * 60_000 : Math.max(Math.round((intervalMinutes ?? 0) * 60_000), MIN_INTERVAL_MS);
        const schedule = await scheduleStore.create({
          name: (name ?? prompt).slice(0, 60),
          prompt,
          intervalMs,
          ...(cadence ? { cadence } : {}),
          once: once === true,
          operationId: options.sessionId && toolOptions?.toolCallId ? `schedule-tool:${options.sessionId}:${toolOptions.toolCallId}` : undefined,
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
      execute: async ({ id }, toolOptions) => {
        await confirm('delete_schedule', { id }, toolOptions?.toolCallId);
        await scheduleStore.remove(id);
        return { ok: true, id };
      },
    }),
  };
}

/** Runs a schedule tool call the user just approved on its card; the shape matches the other `executeApproved` helpers. */
export async function runApprovedScheduleTool(
  scheduleStore: ScheduleStore,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
  toolCallId: string,
): Promise<{ result?: string; error?: string }> {
  const tools = createScheduleTools({ scheduleStore, sessionId, skipApproval: true });
  const target = (tools as Record<string, { execute?: (input: never, options: never) => Promise<unknown> }>)[name];
  if (!target?.execute) return { error: `Unknown tool ${name}` };
  try {
    return { result: JSON.stringify(await target.execute(args as never, { toolCallId } as never)) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
