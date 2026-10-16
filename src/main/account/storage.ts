import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AccountCredential } from './service';

export interface CredentialEncryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?: () => string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export function createAccountStorage(root: string, encryption: CredentialEncryption) {
  const file = path.join(root, 'account-session.enc');
  const secure = () => {
    if (!encryption.isEncryptionAvailable() || encryption.getSelectedStorageBackend?.() === 'basic_text') throw new Error('Secure credential storage unavailable');
  };
  return {
    read(): AccountCredential | null {
      if (!existsSync(file)) return null;
      secure();
      return JSON.parse(encryption.decryptString(readFileSync(file))) as AccountCredential;
    },
    write(value: AccountCredential | null) {
      if (!value) { rmSync(file, { force: true }); return; }
      secure(); mkdirSync(root, { recursive: true });
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, encryption.encryptString(JSON.stringify(value)), { mode: 0o600 });
      renameSync(temporary, file);
    },
  };
}
