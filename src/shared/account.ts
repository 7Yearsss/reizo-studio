export interface AccountUser { id: string; username: string; displayName: string; email: string | null }
export interface AccountState {
  status: 'signed-out' | 'pending' | 'authenticated' | 'offline';
  user?: AccountUser;
  code?: string;
  expiresAt?: string;
  message?: string;
  webOrigin: string;
}
