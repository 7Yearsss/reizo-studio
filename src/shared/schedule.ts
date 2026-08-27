export const SCHEDULE_PRESETS = [
  { id: '15m', label: '每 15 分钟', intervalMs: 15 * 60 * 1000 },
  { id: '30m', label: '每 30 分钟', intervalMs: 30 * 60 * 1000 },
  { id: '1h', label: '每小时', intervalMs: 60 * 60 * 1000 },
  { id: '6h', label: '每 6 小时', intervalMs: 6 * 60 * 60 * 1000 },
  { id: '1d', label: '每天', intervalMs: 24 * 60 * 60 * 1000 },
] as const;

export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  skillId?: string;
  intervalMs: number;
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
