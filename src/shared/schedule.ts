export const SCHEDULE_PRESETS = [
  { id: '15m', label: '每 15 分钟', intervalMs: 15 * 60 * 1000 },
  { id: '30m', label: '每 30 分钟', intervalMs: 30 * 60 * 1000 },
  { id: '1h', label: '每小时', intervalMs: 60 * 60 * 1000 },
  { id: '6h', label: '每 6 小时', intervalMs: 6 * 60 * 60 * 1000 },
  { id: '1d', label: '每天', intervalMs: 24 * 60 * 60 * 1000 },
] as const;

/** A recurring automation that fails this many runs in a row is paused instead of burning cost. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * The most an unattended run may do, whatever the global permission mode is. It can only tighten:
 * `readonly` (read and analyse), `workspace` (also write inside the workspace), `inherit` (the global mode).
 */
export type RunPermission = 'readonly' | 'workspace' | 'inherit';

/** How many past runs a schedule remembers. */
export const MAX_RUN_HISTORY = 20;

export interface ScheduleRun {
  executionId: string;
  kind: 'scheduled' | 'manual';
  startedAt: string;
  endedAt: string;
  outcome: 'succeeded' | 'failed' | 'interrupted';
  error: string | null;
  sessionId?: string;
}

export interface Schedule {
  /** Unattended-run ceiling. New automations default to read-only; schedules saved before this existed run as `workspace`. */
  runPermission?: RunPermission;
  /** When set, runs fall on this wall-clock time instead of every `intervalMs`. */
  cadence?: ScheduleCadence;
  /** Most recent first, capped at MAX_RUN_HISTORY. */
  runs?: ScheduleRun[];
  id: string;
  name: string;
  prompt: string;
  skillId?: string;
  intervalMs: number;
  /** One-shot schedules pause after one attempt; their result and failures remain visible. */
  once?: boolean;
  createOperationId?: string;
  pendingRun?: { operationId: string; requestedAt: string };
  activeExecution?: { id: string; startedAt: string; kind: 'scheduled' | 'manual'; sessionId?: string; operationId?: string };
  lastExecutionId?: string;
  lastSessionId?: string;
  lastRunOperationId?: string;
  lastOutcome?: 'succeeded' | 'failed' | 'interrupted';
  /** Failed runs since the last success; reset by a success or by re-enabling. */
  consecutiveFailures?: number;
  /** Set when the schedule was paused automatically (not by the user). */
  autoPausedAt?: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  lastError: string | null;
  runCount: number;
  createdAt: string;
}

export interface Thought {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
}

export interface SchedulePatch {
  name?: string;
  prompt?: string;
  skillId?: string | null;
  intervalMs?: number;
  enabled?: boolean;
  nextRunAt?: string;
}

/** Wall-clock cadence in the user's local time: "weekdays at 09:00". Overrides the fixed interval for when the next run falls. */
export interface ScheduleCadence {
  kind: 'daily' | 'weekdays' | 'weekly';
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday; only for `weekly`. */
  dayOfWeek?: number;
}

export function isValidCadence(value: unknown): value is ScheduleCadence {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<ScheduleCadence>;
  if (c.kind !== 'daily' && c.kind !== 'weekdays' && c.kind !== 'weekly') return false;
  if (!Number.isInteger(c.hour) || c.hour! < 0 || c.hour! > 23) return false;
  if (!Number.isInteger(c.minute) || c.minute! < 0 || c.minute! > 59) return false;
  if (c.kind === 'weekly') return Number.isInteger(c.dayOfWeek) && c.dayOfWeek! >= 0 && c.dayOfWeek! <= 6;
  return c.dayOfWeek === undefined;
}

/** The first run strictly after `after`, in local time. */
export function nextCadenceRun(cadence: ScheduleCadence, after: Date): Date {
  for (let offset = 0; offset <= 8; offset++) {
    const candidate = new Date(after.getFullYear(), after.getMonth(), after.getDate() + offset, cadence.hour, cadence.minute, 0, 0);
    if (candidate.getTime() <= after.getTime()) continue;
    const day = candidate.getDay();
    if (cadence.kind === 'weekdays' && (day === 0 || day === 6)) continue;
    if (cadence.kind === 'weekly' && day !== cadence.dayOfWeek) continue;
    return candidate;
  }
  throw new Error('invalid cadence');
}

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

export function describeCadence(cadence: ScheduleCadence): string {
  const time = `${String(cadence.hour).padStart(2, '0')}:${String(cadence.minute).padStart(2, '0')}`;
  if (cadence.kind === 'daily') return `每天 ${time}`;
  if (cadence.kind === 'weekdays') return `工作日 ${time}`;
  return `每周${DAY_NAMES[cadence.dayOfWeek ?? 0]} ${time}`;
}
