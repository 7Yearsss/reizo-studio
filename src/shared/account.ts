import type { ModelCatalog } from './modelCatalog';
export interface AccountUser { id: string; username: string; displayName: string; email: string | null }
/** Main-process only. Never include this object in AccountState or renderer IPC. */
export interface AccountModelCredential {
  organizationId: string;
  organizationName: string;
  apiKey: string;
  baseUrl: string;
  expiresAt: string;
  models: { id: string; name: string }[];
  catalog?: ModelCatalog;
}
export interface AccountState {
  status: 'signed-out' | 'pending' | 'authenticated' | 'offline';
  user?: AccountUser;
  code?: string;
  expiresAt?: string;
  message?: string;
  webOrigin: string;
  models?: { ready: boolean; organizationId?: string; organizationName?: string; catalogVersion?: string; message?: string };
}
