export interface Project {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPatch {
  name?: string;
  description?: string | null;
  instructions?: string | null;
}
