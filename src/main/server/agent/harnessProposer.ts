import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateSkill, type Skill } from '../../skills';
import { parseSubagentFile, type SubagentRole } from './subagentTools';
import { summarizeTraceHistory, type TurnTrace } from './turnTrace';

/**
 * Harness² B4, B5 & D4: Two-Dimension (`INV` / `DOM`) Harness Proposer & Isolated Staging Sandbox.
 * - `INV` (Task-Agnostic Invariants): Recurring multi-turn tool/execution failures map to general
 *   memory lessons (`memory/*.md`), never polluting global rules with 1/k single-turn noise.
 * - `DOM` (Domain Skills & Sub-Agents): Domain-specific workflows map to modular `SKILL.md` or
 *   `sub_agents/<name>/AGENT.md` packages validated by `validateSkill` / `parseSubagentFile`.
 * - D4 (Git-Free Isolated Staging): Proposer staging directory refuses to operate inside a `.git`
 *   repository root and never exposes `.git` history to the proposer.
 */

export type ProposalDimension = 'INV' | 'DOM';

export interface HarnessProposal {
  dimension: ProposalDimension;
  targetKind: 'lesson_memory' | 'skill' | 'subagent';
  id: string;
  title: string;
  rationale: string;
  content: string;
}

/**
 * Harness² D4: Prepare an isolated staging directory for proposer artifacts and assert
 * that no `.git` directory exists inside it.
 */
export async function prepareIsolatedProposerDir(baseRoot: string, runId: string): Promise<string> {
  const safeId = runId.replace(/[^\w.-]/g, '_');
  const stagingDir = path.join(baseRoot, 'proposer-staging', safeId);
  await mkdir(stagingDir, { recursive: true });
  const entries = await readdir(stagingDir).catch(() => [] as string[]);
  if (entries.includes('.git')) {
    throw new Error('Proposer staging directory must not contain a .git repository');
  }
  return stagingDir;
}

/**
 * Harness² B4 & B6: Deterministically synthesize `INV` (cross-turn invariant lessons) from
 * multi-turn trace history, ignoring single-turn 1/k failures.
 */
export function proposeInvariantLessonsFromTraces(traces: TurnTrace[]): HarnessProposal[] {
  const summary = summarizeTraceHistory(traces);
  const proposals: HarnessProposal[] = [];

  for (const failure of summary.recurringToolFailures) {
    proposals.push({
      dimension: 'INV',
      targetKind: 'lesson_memory',
      id: `recurring-${failure.tool.replace(/[^\w-]+/g, '-')}-failure`,
      title: `Avoid recurring ${failure.tool} failures`,
      rationale: `Tool "${failure.tool}" failed across ${failure.failedTurns}/${summary.totalTurns} turns (${failure.totalCalls} total failed calls).`,
      content: [
        `- **Cue**: Calling \`${failure.tool}\` when similar errors occurred previously`,
        `- **Lesson**: Verify target existence, version, and input schema before invoking \`${failure.tool}\`; switch strategy immediately if it fails.`,
        `- **Evidence**: Failed in ${failure.failedTurns} turns${failure.sampleError ? ` (sample: ${failure.sampleError})` : ''}`,
        `- **Confidence**: high`,
      ].join('\n'),
    });
  }

  if (summary.undeliveredCount >= 2) {
    proposals.push({
      dimension: 'INV',
      targetKind: 'lesson_memory',
      id: 'deliverable-completion-check',
      title: 'Ensure deliverable tools are called before stopping',
      rationale: `Agent stopped without producing the requested deliverable in ${summary.undeliveredCount} turns.`,
      content: [
        '- **Cue**: User asks to generate or export a spreadsheet, document, presentation, or diagram',
        '- **Lesson**: Always invoke the corresponding generation tool (`generate_sheet`, `generate_document`, `generate_presentation`, `generate_diagram`) before sending a concluding reply.',
        `- **Evidence**: Triggered undelivered continuation in ${summary.undeliveredCount} turns`,
        '- **Confidence**: high',
      ].join('\n'),
    });
  }

  const signals: Array<{ turns: number; id: string; title: string; lesson: string; cue: string }> = [
    {
      turns: summary.loopHaltTurns, id: 'break-tool-loops', title: 'Change approach instead of repeating a failing action',
      cue: 'The same tool call or a near-identical retry keeps failing',
      lesson: 'After two failed attempts at the same action, stop retrying: read the error, change the approach or inputs, or tell the user what is blocking you.',
    },
    {
      turns: summary.reasoningLeakTurns, id: 'keep-reasoning-out-of-reply', title: 'Keep internal reasoning out of the final reply',
      cue: 'Writing the final answer to the user',
      lesson: 'The reply contains only the answer and what the user needs to act on; never paste planning notes, tool-selection thoughts or self-talk.',
    },
    {
      turns: summary.deferredTurns, id: 'act-instead-of-deferring', title: 'Do the work in this turn instead of promising to',
      cue: 'About to end a turn with "I will check / continue later"',
      lesson: 'If the next step is something you can do now, do it now with a tool call; otherwise say plainly what is left and why you stopped.',
    },
    {
      turns: summary.openTodoTurns, id: 'close-todos-before-finishing', title: 'Resolve the todo list before the final reply',
      cue: 'A todo list exists and items are still open',
      lesson: 'Complete or explicitly drop every open todo before concluding, and update the list so it matches what was actually done.',
    },
  ];
  for (const signal of signals) {
    if (signal.turns < 2) continue;
    proposals.push({
      dimension: 'INV',
      targetKind: 'lesson_memory',
      id: signal.id,
      title: signal.title,
      rationale: `Seen in ${signal.turns}/${summary.totalTurns} recent turns.`,
      content: [
        `- **Cue**: ${signal.cue}`,
        `- **Lesson**: ${signal.lesson}`,
        `- **Evidence**: ${signal.turns} turns`,
        '- **Confidence**: high',
      ].join('\n'),
    });
  }

  return proposals;
}

/**
 * Harness² B5 & D6: Stage and validate a proposed `DOM` skill or sub-agent inside the isolated staging dir
 * before it can be promoted into the user's active skills/sub-agents directory.
 */
export async function stageAndValidateDomProposal(
  stagingDir: string,
  proposal: HarnessProposal,
): Promise<{ valid: boolean; issues: string[]; stagedPath: string }> {
  const gitStat = await stat(path.join(stagingDir, '.git')).catch((): null => null);
  if (gitStat) {
    return {
      valid: false,
      issues: ['staging directory contains forbidden .git metadata'],
      stagedPath: stagingDir,
    };
  }

  if (proposal.targetKind === 'skill') {
    const skillDir = path.join(stagingDir, 'skills', proposal.id);
    await mkdir(skillDir, { recursive: true });
    const file = path.join(skillDir, 'SKILL.md');
    await writeFile(file, proposal.content, 'utf8');
    const skill: Skill = {
      id: proposal.id,
      name: proposal.title,
      description: proposal.rationale,
      body: proposal.content,
      source: 'user',
      dir: skillDir,
    };
    const issues = await validateSkill(skill);
    return { valid: issues.length === 0, issues, stagedPath: file };
  }

  if (proposal.targetKind === 'subagent') {
    const agentDir = path.join(stagingDir, 'sub_agents', proposal.id);
    await mkdir(agentDir, { recursive: true });
    const file = path.join(agentDir, 'AGENT.md');
    await writeFile(file, proposal.content, 'utf8');
    const parsed: SubagentRole | null = parseSubagentFile(proposal.content, proposal.id);
    const issues: string[] = [];
    if (!parsed) issues.push('sub-agent file is empty');
    else if (!parsed.instructions || parsed.instructions.length < 10) {
      issues.push('sub-agent instructions are too short');
    }
    return { valid: issues.length === 0, issues, stagedPath: file };
  }

  const memFile = path.join(stagingDir, 'memory', `${proposal.id}.md`);
  await mkdir(path.dirname(memFile), { recursive: true });
  await writeFile(memFile, proposal.content, 'utf8');
  return { valid: true, issues: [], stagedPath: memFile };
}
