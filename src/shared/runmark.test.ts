import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkRunmark, computeConfigFingerprint, writeRunmark } from './runmark';

describe('runmark fingerprint and cache validity (Harness² D1)', () => {
  it('computes order-independent SHA-256 config fingerprints and validates outputs', async () => {
    expect(computeConfigFingerprint({ a: 1, b: [2, 3] })).toBe(
      computeConfigFingerprint({ b: [2, 3], a: 1 }),
    );
    expect(computeConfigFingerprint({ a: 1 })).not.toBe(computeConfigFingerprint({ a: 2 }));

    const dir = await mkdtemp(path.join(os.tmpdir(), 'runmark-'));
    try {
      const cfg = { model: 'gpt-image-2', prompt: 'sunset', size: '1024x1024' };
      const outPath = path.join(dir, 'out.png');
      await writeFile(outPath, 'png-bytes', 'utf8');
      await writeRunmark(dir, cfg, ['out.png']);

      const ok = await checkRunmark(dir, cfg, async (rel) => {
        const s = await stat(path.join(dir, rel)).catch((): null => null);
        return Boolean(s && s.size > 0);
      });
      expect(ok.valid).toBe(true);

      const stale = await checkRunmark(dir, { ...cfg, prompt: 'sunrise' });
      expect(stale.valid).toBe(false);
      expect(stale.reason).toContain('fingerprint mismatch');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
