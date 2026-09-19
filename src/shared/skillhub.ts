/** SkillHub (skillhub.cn) marketplace DTOs shared by main + renderer. */

export interface SkillHubEntry {
  slug: string;
  /** namespace handle, e.g. "clawhub_paudyyin" — required to disambiguate duplicate slugs. */
  namespace: string;
  /** "@handle/slug" */
  canonicalName: string;
  name: string;
  description: string;
  downloads: number;
  installs: number;
  stars: number;
  score: number;
  version: string;
  /** clawhub | community | enterprise */
  source: string;
  iconUrl?: string;
  verified: boolean;
  category?: string;
}

export interface SkillHubSearchQuery {
  keyword?: string;
  category?: string;
  source?: string;
  /** updated_at | downloads | stars | installs | score */
  sortBy?: string;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface SkillHubSearchResult {
  items: SkillHubEntry[];
  total: number;
}

export interface SkillHubInstallRequest {
  slug: string;
  namespace: string;
  version?: string;
}

export interface SkillHubInstallResult {
  /** Installed skill id (directory name under data/skills). */
  id: string;
}
