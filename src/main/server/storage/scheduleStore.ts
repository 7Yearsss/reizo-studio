import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { MAX_CONSECUTIVE_FAILURES, MAX_RUN_HISTORY, isValidCadence, nextCadenceRun, type RunPermission, type ScheduleCadence, type Schedule, type SchedulePatch, type ScheduleRun } from '../../../shared/schedule';
import { serializeFileMutation, writeTextAtomic } from './atomicFile';

interface Receipt { operationId: string; kind: 'create' | 'run'; fingerprint: string; scheduleId: string }
interface Disk { schedules: Schedule[]; receipts: Receipt[] }
export const MIN_SCHEDULE_INTERVAL_MS = 60_000;
export class ScheduleValidationError extends Error {
  constructor(message = '自动化间隔必须是至少 60 秒的有限整数（毫秒），且下次运行时间有效', readonly status: 400 | 409 = 400) { super(message); this.name = 'ScheduleValidationError'; }
}
export function validateScheduleInterval(interval: unknown): asserts interval is number {
  if (typeof interval !== 'number' || !Number.isSafeInteger(interval) || interval < MIN_SCHEDULE_INTERVAL_MS || !Number.isFinite(new Date(Date.now() + interval).getTime())) throw new ScheduleValidationError();
}
function operationId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new ScheduleValidationError('自动化操作需要有效的请求标识');
}
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Outcome = NonNullable<Schedule['lastOutcome']>;

export function createScheduleStore(root: string) {
  const file = path.join(root, 'schedules.json');
  async function readDisk(): Promise<Disk> {
    try {
      const disk = JSON.parse(await readFile(file, 'utf8')) as Partial<Disk>;
      if (!Array.isArray(disk.schedules) || disk.receipts !== undefined && !Array.isArray(disk.receipts)) throw new Error('自动化记录格式异常，已保留原文件，请复核存储');
      return { schedules: disk.schedules, receipts: disk.receipts ?? [] };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schedules: [], receipts: [] }; throw error; }
  }
  const write = (disk: Disk) => writeTextAtomic(file, JSON.stringify(disk, null, 2));
  const mutate = <T>(action: (disk: Disk) => Promise<T>) => serializeFileMutation(file, async () => action(await readDisk()));
  function replay(disk: Disk, id: string, kind: Receipt['kind'], hash: string): Schedule | undefined {
    const receipt = disk.receipts.find((item) => item.operationId === id);
    if (!receipt) return;
    if (receipt.kind !== kind || receipt.fingerprint !== hash) throw new ScheduleValidationError('该请求标识已用于不同的自动化操作', 409);
    const schedule = disk.schedules.find((item) => item.id === receipt.scheduleId);
    if (!schedule) throw new ScheduleValidationError('该自动化已删除，原请求不会重新创建或执行', 409);
    return schedule;
  }
  function finish(current: Schedule, outcome: Outcome, error: string | null, executionId?: string) {
    const now = Date.now();
    current.lastRunAt = new Date(now).toISOString();
    let interval = current.intervalMs;
    try { validateScheduleInterval(interval); } catch { interval = MIN_SCHEDULE_INTERVAL_MS; }
    current.nextRunAt = (current.cadence ? nextCadenceRun(current.cadence, new Date(now)) : new Date(now + interval)).toISOString();
    current.lastError = error; current.lastOutcome = outcome; current.runCount += 1;
    if (executionId) current.lastExecutionId = executionId;
    if (current.activeExecution?.sessionId) current.lastSessionId = current.activeExecution.sessionId;
    if (current.activeExecution?.operationId) current.lastRunOperationId = current.activeExecution.operationId;
    if (current.activeExecution) {
      const run: ScheduleRun = { executionId: current.activeExecution.id, kind: current.activeExecution.kind, startedAt: current.activeExecution.startedAt, endedAt: new Date(now).toISOString(), outcome, error, ...(current.activeExecution.sessionId ? { sessionId: current.activeExecution.sessionId } : {}) };
      current.runs = [run, ...(current.runs ?? [])].slice(0, MAX_RUN_HISTORY);
    }
    delete current.activeExecution;
    if (outcome === 'succeeded') current.consecutiveFailures = 0;
    if (outcome === 'failed') current.consecutiveFailures = (current.consecutiveFailures ?? 0) + 1;
    if (current.once || outcome === 'interrupted') current.enabled = false;
    else if (current.enabled && (current.consecutiveFailures ?? 0) >= MAX_CONSECUTIVE_FAILURES) {
      current.enabled = false;
      current.autoPausedAt = new Date(now).toISOString();
      current.lastError = `连续失败 ${current.consecutiveFailures} 次，已自动暂停${error ? `：${error}` : ''}`;
    }
  }
  return {
    async list(): Promise<Schedule[]> { return (await readDisk()).schedules; },
    async create(input: { name: string; prompt: string; intervalMs: number; skillId?: string; once?: boolean; operationId?: string; cadence?: ScheduleCadence; runPermission?: RunPermission }): Promise<Schedule> {
      if (input.runPermission !== undefined && !['readonly', 'workspace', 'inherit'].includes(input.runPermission)) throw new ScheduleValidationError('自动化权限档无效');
      validateScheduleInterval(input.intervalMs);
      if (input.cadence !== undefined && !isValidCadence(input.cadence)) throw new ScheduleValidationError('自动化运行时间无效');
      const id = input.operationId ?? nanoid(); operationId(id);
      const values = { name: input.name.trim() || input.prompt.slice(0, 40), prompt: input.prompt, intervalMs: input.intervalMs, skillId: input.skillId, once: input.once === true || undefined, cadence: input.cadence, runPermission: input.runPermission ?? 'readonly' };
      const hash = fingerprint(values);
      return mutate(async (disk) => {
        const previous = replay(disk, id, 'create', hash); if (previous) return previous;
        const now = Date.now();
        const schedule: Schedule = { ...values, id: nanoid(), createOperationId: id, enabled: true, lastRunAt: null, nextRunAt: (input.cadence ? nextCadenceRun(input.cadence, new Date(now)) : new Date(now + input.intervalMs)).toISOString(), lastError: null, runCount: 0, createdAt: new Date(now).toISOString() };
        disk.schedules.unshift(schedule); disk.receipts.push({ operationId: id, kind: 'create', fingerprint: hash, scheduleId: schedule.id });
        await write(disk); return schedule;
      });
    },
    async update(id: string, patch: SchedulePatch): Promise<Schedule | null> {
      if (patch.intervalMs !== undefined) validateScheduleInterval(patch.intervalMs);
      if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean' || patch.nextRunAt !== undefined && !Number.isFinite(Date.parse(patch.nextRunAt))) throw new ScheduleValidationError('自动化启用状态或下次时间无效');
      if (patch.name !== undefined && typeof patch.name !== 'string' || patch.prompt !== undefined && (typeof patch.prompt !== 'string' || !patch.prompt.trim()) || patch.skillId !== undefined && patch.skillId !== null && typeof patch.skillId !== 'string') throw new ScheduleValidationError('自动化名称、提示词或技能无效');
      return mutate(async (disk) => {
        const current = disk.schedules.find((item) => item.id === id); if (!current) return null;
        if (current.activeExecution && ['name', 'prompt', 'skillId', 'intervalMs', 'nextRunAt'].some((key) => Object.hasOwn(patch, key))) throw new ScheduleValidationError('执行期间不能修改自动化输入，请等待结果后修改', 409);
        if (patch.name !== undefined) current.name = patch.name;
        if (patch.prompt !== undefined) current.prompt = patch.prompt;
        if (patch.skillId !== undefined) current.skillId = patch.skillId ?? undefined;
        if (patch.intervalMs !== undefined) { current.intervalMs = patch.intervalMs; current.nextRunAt = new Date(Date.now() + patch.intervalMs).toISOString(); }
        if (patch.enabled !== undefined) {
          current.enabled = patch.enabled;
          if (patch.enabled) { current.consecutiveFailures = 0; delete current.autoPausedAt; }
          if (!patch.enabled) delete current.pendingRun;
          else if (patch.nextRunAt === undefined && !current.activeExecution) current.nextRunAt = (current.cadence ? nextCadenceRun(current.cadence, new Date()) : new Date(Date.now() + current.intervalMs)).toISOString();
        }
        if (patch.nextRunAt) current.nextRunAt = patch.nextRunAt;
        await write(disk); return current;
      });
    },
    async requestRun(id: string, requestId: string): Promise<Schedule | null> {
      operationId(requestId);
      const hash = fingerprint({ scheduleId: id });
      return mutate(async (disk) => {
        const previous = replay(disk, requestId, 'run', hash); if (previous) return previous;
        const current = disk.schedules.find((item) => item.id === id); if (!current) return null;
        validateScheduleInterval(current.intervalMs);
        if (current.activeExecution || current.pendingRun) throw new ScheduleValidationError('自动化已有待执行或执行中的请求，请先查看结果', 409);
        current.pendingRun = { operationId: requestId, requestedAt: new Date().toISOString() };
        current.nextRunAt = new Date().toISOString();
        disk.receipts.push({ operationId: requestId, kind: 'run', fingerprint: hash, scheduleId: id });
        await write(disk); return current;
      });
    },
    remove(id: string): Promise<void> {
      return mutate(async (disk) => {
        const current = disk.schedules.find((item) => item.id === id);
        if (current?.activeExecution) throw new ScheduleValidationError('执行中的自动化不能删除；可暂停后续执行并查看当前结果', 409);
        disk.schedules = disk.schedules.filter((item) => item.id !== id);
        await write(disk);
      });
    },
    async due(now = Date.now()): Promise<Schedule[]> {
      return (await readDisk()).schedules.filter((item) => {
        try { validateScheduleInterval(item.intervalMs); } catch { return false; }
        return (item.enabled || Boolean(item.pendingRun)) && !item.activeExecution && Date.parse(item.nextRunAt) <= now;
      });
    },
    async claimRun(id: string, executionId: string): Promise<Schedule | null> {
      operationId(executionId);
      return mutate(async (disk) => {
        const current = disk.schedules.find((item) => item.id === id); if (!current) return null;
        validateScheduleInterval(current.intervalMs);
        if (current.activeExecution || !(current.enabled || current.pendingRun) || !Number.isFinite(Date.parse(current.nextRunAt)) || Date.parse(current.nextRunAt) > Date.now()) return null;
        current.activeExecution = { id: executionId, startedAt: new Date().toISOString(), kind: current.pendingRun ? 'manual' : 'scheduled', ...(current.pendingRun ? { operationId: current.pendingRun.operationId } : {}) };
        current.lastExecutionId = executionId;
        delete current.lastSessionId;
        delete current.pendingRun;
        await write(disk); return current;
      });
    },
    attachSession(id: string, executionId: string, sessionId: string): Promise<boolean> {
      return mutate(async (disk) => {
        const current = disk.schedules.find((item) => item.id === id);
        if (!current?.activeExecution || current.activeExecution.id !== executionId) return false;
        current.activeExecution.sessionId = sessionId; current.lastSessionId = sessionId;
        await write(disk); return true;
      });
    },
    finishExecution(id: string, executionId: string, outcome: Outcome, error: string | null): Promise<boolean> {
      return mutate(async (disk) => {
        const current = disk.schedules.find((item) => item.id === id);
        if (!current?.activeExecution || current.activeExecution.id !== executionId) return false;
        finish(current, outcome, error, executionId); await write(disk); return true;
      });
    },
    interruptActive(reason = '应用在执行期间退出，结果尚未确认；已暂停自动化，请先查看关联会话再手动重试'): Promise<number> {
      return mutate(async (disk) => {
        let count = 0;
        for (const current of disk.schedules) if (current.activeExecution) { finish(current, 'interrupted', reason, current.activeExecution.id); count++; }
        if (count) await write(disk);
        return count;
      });
    },
    markRun(id: string, error: string | null): Promise<void> {
      return mutate(async (disk) => { const current = disk.schedules.find((item) => item.id === id); if (!current) return; finish(current, error ? 'failed' : 'succeeded', error, current.activeExecution?.id); await write(disk); });
    },
  };
}
export type ScheduleStore = ReturnType<typeof createScheduleStore>;
