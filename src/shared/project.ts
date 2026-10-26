export interface Project {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  /** New conversations in this project start with this skill unless the message names another. */
  defaultSkillId?: string;
  /** … and this model unless the message names another. */
  defaultModel?: { providerId?: string; model: string };
  pinned?: boolean;
  /** Archived projects are hidden from the list but keep everything; restoring clears this. */
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPatch {
  name?: string;
  description?: string | null;
  instructions?: string | null;
  defaultSkillId?: string | null;
  defaultModel?: { providerId?: string; model: string } | null;
  pinned?: boolean;
  archived?: boolean;
}
