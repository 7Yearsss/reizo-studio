import { describe, expect, it } from 'vitest';
import { hasSecret, redactSecrets } from './redactSecrets';

describe('redactSecrets', () => {
  it('redacts an OpenAI key', () => {
    expect(redactSecrets('key sk-proj-abcdefghijklmnopqrstuvwxyz012345 end')).toBe(
      'key [REDACTED:openai-key] end',
    );
  });

  it('redacts an Anthropic key', () => {
    expect(redactSecrets('ANTHROPIC_API_KEY=sk-ant-abc123def456ghi789jkl012')).toContain(
      '[REDACTED:',
    );
  });

  it('redacts an AWS access key id', () => {
    expect(redactSecrets('id AKIAIOSFODNN7EXAMPLE here')).toBe('id [REDACTED:aws-access-key] here');
  });

  it('redacts a GitHub token', () => {
    const t = 'ghp_' + 'a'.repeat(36);
    expect(redactSecrets(`token: ${t}`)).toBe('token: [REDACTED:github-token]');
  });

  it('redacts a PEM private key block', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOwIBAAJB\nabcd\n-----END RSA PRIVATE KEY-----';
    expect(redactSecrets(`before ${pem} after`)).toBe('before [REDACTED:private-key] after');
  });

  it('redacts a generic assignment', () => {
    expect(redactSecrets('DATABASE_PASSWORD = "hunter2hunter2"')).toBe(
      'DATABASE_PASSWORD = [REDACTED:secret]',
    );
    expect(redactSecrets("my_secret: 'longenoughvalue'")).toBe('my_secret: [REDACTED:secret]');
  });

  it('leaves ordinary text alone', () => {
    const plain = 'The quick brown fox jumps over the lazy dog. token count: 42';
    expect(redactSecrets(plain)).toBe(plain);
    expect(hasSecret(plain)).toBe(false);
  });

  it('hasSecret flags a match', () => {
    expect(hasSecret('sk-ant-abcdefghijklmnopqrstuvwx')).toBe(true);
  });
});
