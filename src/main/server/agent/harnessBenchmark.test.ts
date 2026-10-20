import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createBaseReizoHarnessTree,
  readTunedHarnessTree,
  REIZO_OFFICE_BENCHMARK_TASKS,
  runHarnessTuningForTask,
  runReizoHarnessBenchmarkSuite,
  validateHarnessTree,
} from './harnessBenchmark';

describe('Reizo Harness² Benchmark & Auto-Tuner (Category E: E1 + E2 + E3 + D7)', () => {
  it('runs the full Propose–Probe–Compose–Select–Experience loop and auto-tunes Prompt & Skills', async () => {
    const runsRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-bench-'));
    try {
      const suite = await runReizoHarnessBenchmarkSuite({ runsRoot });
      expect(suite.results).toHaveLength(3);
      expect(suite.meanAdoptedScore).toBeGreaterThan(suite.meanBaseScore);
      expect(suite.meanAdoptedScore).toBe(1);
      expect(suite.experiences.length).toBeGreaterThanOrEqual(3);

      // Verify tuned skills and memory were updated and persisted
      expect(suite.finalTree['skills/excel-workbook/SKILL.md']).toContain('=SUM(');
      expect(suite.finalTree['skills/doc-writer/SKILL.md']).toContain('check_document');
      expect(suite.finalTree['skills/ppt-designer/SKILL.md']).toContain('1280×720');
      expect(suite.finalTree['memory.md']).toContain('excel-lesson');

      const persisted = await readTunedHarnessTree(runsRoot);
      expect(persisted['skills/excel-workbook/SKILL.md']).toContain('=SUM(');
      expect(suite.results.every((r) => r.ledger.identityValid)).toBe(true);
    } finally {
      await rm(runsRoot, { recursive: true, force: true });
    }
  });

  it('retries invalid proposals and falls back to base harness if validation still fails', async () => {
    const runsRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-bench-fallback-'));
    try {
      const base = createBaseReizoHarnessTree();
      expect(validateHarnessTree(base)).toEqual([]);

      const res = await runHarnessTuningForTask({
        task: REIZO_OFFICE_BENCHMARK_TASKS[0],
        baseTree: base,
        runsRoot,
        // Inject a secret key so validateHarnessTree rejects both attempts of inv1
        customInvMutator: (t) => ({ ...t, 'guardrails.md': 'leaked key sk-1234567890abcdefghijklmnop' }),
      });

      const invStage = res.stages.find((s) => s.label === 'inv1')!;
      expect(invStage.fellBack).toBe(true);
      expect(invStage.keptBase).toBe(true);
      expect(invStage.attempts).toBe(2);
      // DOM stage still succeeded and improved the task score to 1.0
      expect(res.adoptedScore?.score).toBe(1);
    } finally {
      await rm(runsRoot, { recursive: true, force: true });
    }
  });
});
