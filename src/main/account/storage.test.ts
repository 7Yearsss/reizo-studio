import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAccountStorage } from './storage';

describe('account credential storage', () => {
  it('stores only encryption output and removes it on logout', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'reizo-account-'));
    try {
      let plaintext = '';
      const encryption = { isEncryptionAvailable: () => true, encryptString: vi.fn((s: string) => { plaintext = s; return Buffer.from('encrypted-envelope'); }), decryptString: vi.fn(() => plaintext) };
      const storage = createAccountStorage(root, encryption);
      const value = { token: 'secret', origin: 'https://reizo.example', expiresAt: '2030-01-01', user: { id: 'u', username: 'u', displayName: 'User', email: null as string | null } };
      storage.write(value);
      expect(readFileSync(path.join(root, 'account-session.enc'), 'utf8')).toBe('encrypted-envelope');
      expect(storage.read()).toEqual(value);
      storage.write(null); expect(existsSync(path.join(root, 'account-session.enc'))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('never falls back to plaintext or base64 when encryption is unavailable', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'reizo-account-'));
    try {
      for (const backend of ['basic_text', 'unavailable']) {
        const storage = createAccountStorage(root, { isEncryptionAvailable: () => backend !== 'unavailable', getSelectedStorageBackend: () => backend, encryptString: () => Buffer.from('bad'), decryptString: () => '' });
        expect(() => storage.write({ token: 'secret' } as never)).toThrow();
        expect(existsSync(path.join(root, 'account-session.enc'))).toBe(false);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
