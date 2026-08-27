import * as api from '../api';
import type { Project } from '../../shared/project';

export interface ProjectState {
  projects: Project[];
  loaded: boolean;
}

let state: ProjectState = { projects: [], loaded: false };
const listeners = new Set<() => void>();

function setState(patch: Partial<ProjectState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): ProjectState {
  return state;
}

export async function loadProjects(): Promise<void> {
  const projects = await api.listProjects();
  setState({ projects, loaded: true });
}

export async function createProject(input: {
  name: string;
  description?: string;
  instructions?: string;
}): Promise<Project> {
  const project = await api.createProject(input);
  setState({ projects: [project, ...state.projects.filter((p) => p.id !== project.id)] });
  return project;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const project = await api.patchProject(id, { name });
  setState({ projects: state.projects.map((p) => (p.id === id ? project : p)) });
}

export async function deleteProject(id: string): Promise<void> {
  await api.deleteProject(id);
  setState({ projects: state.projects.filter((p) => p.id !== id) });
}
