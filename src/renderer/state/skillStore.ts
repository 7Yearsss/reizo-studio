import * as api from '../api';

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  prompt?: string;
  source: 'bundled' | 'user';
}

export interface SkillState {
  skills: SkillSummary[];
  loaded: boolean;
}

let skills: SkillSummary[] = [];
let loaded = false;
let snapshot: SkillState = { skills, loaded };
const listeners = new Set<() => void>();

function notify(): void {
  snapshot = { skills, loaded };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): SkillState {
  return snapshot;
}

export async function loadSkills(): Promise<SkillSummary[]> {
  const next = await api.listSkills();
  skills = next;
  loaded = true;
  notify();
  return next;
}

const RECENT_KEY = 'reizo:recentSkills';
const RECENT_MAX = 8;

export function getRecentSkillIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function recordRecentSkill(id: string): void {
  try {
    const next = [id, ...getRecentSkillIds().filter((item) => item !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* localStorage unavailable — recents are best-effort */
  }
}
