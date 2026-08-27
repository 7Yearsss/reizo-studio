import * as api from '../api';

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
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
