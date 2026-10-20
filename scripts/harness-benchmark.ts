/**
 * Harness² CLI Benchmark & Auto-Tuner for Reizo Studio (Category E: E1 + E2 + E3).
 *
 * Runs the Reizo Office Benchmark suite through the recursive Propose–Probe–Compose–Select–Experience
 * loop and writes `summary.json` + `tuned-harness.json`.
 *
 * Usage:
 *   npm run test:eval
 *   npm run test:eval -- --output ./runs/reizo-eval
 */
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runReizoHarnessBenchmarkSuite } from '../src/main/server/agent/harnessBenchmark';

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--output');
  const runsRoot =
    outIdx >= 0 && args[outIdx + 1]
      ? path.resolve(args[outIdx + 1])
      : await mkdtemp(path.join(os.tmpdir(), 'reizo-harness2-eval-'));

  console.log(`[harness2:eval] Running Reizo Office Benchmark & Auto-Tuner in ${runsRoot}...`);
  const suite = await runReizoHarnessBenchmarkSuite({ runsRoot });

  for (const r of suite.results) {
    console.log(
      `  [${r.taskId}] (${r.domain}) base=${r.baseScore?.score.toFixed(2) ?? 'N/A'} -> adopted(${r.selectedLabel}/${r.selectedAnonId})=${r.adoptedScore?.score.toFixed(2) ?? 'N/A'} | ledgerIdentity=${r.ledger.identityValid}`,
    );
  }
  console.log(
    `[harness2:eval] Mean score: ${suite.meanBaseScore.toFixed(3)} -> ${suite.meanAdoptedScore.toFixed(3)} (+${(suite.meanAdoptedScore - suite.meanBaseScore).toFixed(3)})`,
  );
  console.log(
    `[harness2:eval] Modified harness components: ${suite.diffFromInitial.modified.join(', ') || '(none)'}`,
  );
  console.log(`[harness2:eval] Distilled lessons: ${suite.experiences.length}`);
  console.log(`[harness2:eval] Wrote ${path.join(runsRoot, 'summary.json')} and ${path.join(runsRoot, 'tuned-harness.json')}`);
}

main().catch((err) => {
  console.error('[harness2:eval] Failed:', err);
  process.exit(1);
});
