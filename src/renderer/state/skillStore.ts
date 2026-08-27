import * as api from '../api';

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  source: 'bundled' | 'user';
}

let skills: SkillSummary[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): { skills: SkillSummary[]; loaded: boolean } {
  return { skills, loaded };
}

export async function loadSkills(): Promise<SkillSummary[]> {
  const next = await api.listSkills();
  skills = next;
  loaded = true;
  notify();
  return next;
}
