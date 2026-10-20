import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadActiveHarnessRules } from './harnessRules';

describe('loadActiveHarnessRules', () => {
  it('appends a partial guardrail file onto the built-in rules', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'harness-rules-'));
    try {
      await mkdir(path.join(root, 'harness'), { recursive: true });
      await writeFile(path.join(root, 'harness', 'guardrails.md'), 'Custom addon: check the canvas before export.', 'utf8');
      const rules = await loadActiveHarnessRules(root);
      expect(rules.guardrails).toContain('Evidence Boundary Rules:');
      expect(rules.guardrails).toContain('Deliverable Conformance Rules:');
      expect(rules.guardrails).toContain('Custom addon: check the canvas before export.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
