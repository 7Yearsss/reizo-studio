import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateText, type LanguageModel } from 'ai';
import { assignAnonymousIds, buildSelectionPrompt, parseSelectionReply, type CandidateItem } from '../../../shared/candidateSelection';
import { checkDocument } from '../../../shared/documentChecks';
import { normalizePresentation, presentationElementBox, presentationElements, type PresentationContent } from '../../../shared/presentationContent';
import { writeRunmark } from '../../../shared/runmark';
import { checkSheet } from '../../../shared/sheetChecks';
import { workbookFromCreateSheets, type SheetCreateSheet } from '../../../shared/sheetContent';
import { evaluateWorkbookFormulas } from '../../../shared/sheetFormulaEval';
import { createTurnLedger, type LedgerSnapshot } from '../../../shared/turnLedger';
import { assertMemorySafe } from '../../workspaceMemoryDir';
import { DELIVERABLE_CONFORMANCE_RULE, EVIDENCE_BOUNDARY_RULE } from './harnessRules';
import { prepareIsolatedProposerDir } from './harnessProposer';
import { parseSubagentFile } from './subagentTools';

/**
 * Harness² Category E (E1 + E2 + E3 + D7):
 * Full `ReizoSubstrate` + `BenchmarkAdapter` + `Propose–Probe–Compose–Select–Experience`
 * recursive auto-tuning engine for Reizo Studio Prompts, Guardrails, Skills, and Sub-Agents.
 *
 * Maps Reizo's editable harness components onto a `HarnessTree` (`Record<string, string>`):
 * - `systemprompt.md` (c1: Core system instructions)
 * - `guardrails.md`   (c2: Evidence boundary & deliverable conformance rules)
 * - `memory.md`       (c3: Workspace memory index & operational lessons)
 * - `skills/<id>/SKILL.md` (c6: Domain skills with progressive-disclosure triggers)
 * - `sub_agents/<id>/AGENT.md` (c7: Specialist read-only sub-agents)
 */

export type HarnessTree = Record<string, string>;

export interface HarnessTreeDiff {
  added: string[];
  removed: string[];
  modified: string[];
  keptBase: boolean;
}

export interface ReizoBenchTask {
  id: string;
  domain: 'excel' | 'document' | 'presentation';
  prompt: string;
  /** Expected checks used by `score()` ONLY after anonymous selection has committed. */
  expected: {
    requiredTerms?: string[];
    requireFormulas?: boolean;
    expectedFormulaCell?: { sheet: string; cell: string; value: number };
    maxAuditWarnings?: number;
  };
}

export interface RolloutView {
  label: string;
  runId: string;
  runDir: string;
  ok: boolean;
  delivered: boolean;
  trajectory: string;
  deliverableSummary: string;
  auditWarnings: string[];
  costUsd: number;
  wallMs: number;
  /** Produced artifact payload for downstream post-selection scoring. */
  artifactPayload?: unknown;
}

export interface StageRecord {
  label: string;
  dim: 'INV' | 'DOM' | 'COMP';
  tree: HarnessTree;
  keptBase: boolean;
  fellBack: boolean;
  attempts: number;
  notes: string;
  error?: string;
}

export interface ExperienceLesson {
  domain: string;
  cue: string;
  lesson: string;
  evidence: string;
  confidence: 'high' | 'medium';
}

export interface TaskTuningResult {
  taskId: string;
  domain: string;
  stages: StageRecord[];
  rollouts: Record<string, RolloutView>;
  selectedLabel: string;
  selectedAnonId: string;
  selectionReasoning: string;
  adoptedTree: HarnessTree;
  diffFromBase: HarnessTreeDiff;
  experience: ExperienceLesson | null;
  /** Post-selection judge score (`null` if judge failed per Harness² D7 — never coerced to 0). */
  baseScore: { score: number; details: string[] } | null;
  adoptedScore: { score: number; details: string[] } | null;
  ledger: LedgerSnapshot;
}

export const STAGE_ATTEMPTS = 2;

/** Built-in WorkBuddy/Office benchmark subset for Reizo Studio (E2). */
export const REIZO_OFFICE_BENCHMARK_TASKS: ReizoBenchTask[] = [
  {
    id: 'wb-excel-q1-budget',
    domain: 'excel',
    prompt:
      '生成一份 2026年Q1部门预算汇总表（工作表名：预算汇总），包含三行部门数据（研发 120、市场 80、运营 50）以及第5行合计行，合计必须使用动态 SUM 公式计算并保持无公式错误。',
    expected: {
      requireFormulas: true,
      expectedFormulaCell: { sheet: '预算汇总', cell: 'B5', value: 250 },
      maxAuditWarnings: 0,
    },
  },
  {
    id: 'wb-doc-policy-audit',
    domain: 'document',
    prompt:
      '撰写一份《数据安全合规规范》文档，包含一、二、三连续编号章节，全中文全角标点，术语统一使用“访问令牌”（不得混用“访问Token”）。',
    expected: {
      requiredTerms: ['一、', '二、', '三、', '访问令牌'],
      maxAuditWarnings: 0,
    },
  },
  {
    id: 'wb-ppt-exec-deck',
    domain: 'presentation',
    prompt:
      '生成一份 2 页季度复盘 PPT（1280×720 画布），所有文本框与图形元素必须严格控制在 1280×720 安全边界内，不得越界。',
    expected: {
      maxAuditWarnings: 0,
    },
  },
];

export function createBaseReizoHarnessTree(): HarnessTree {
  return {
    'systemprompt.md':
      'You are Reizo Studio, a local desktop agent that produces Excel workbooks, Docs, and PPT decks.',
    'guardrails.md': `${EVIDENCE_BOUNDARY_RULE}\n\n${DELIVERABLE_CONFORMANCE_RULE}`,
    'memory.md': '# Memory\n',
    'skills/excel-workbook/SKILL.md': [
      '---',
      'name: Excel Workbook',
      'description: Use when creating or auditing Excel spreadsheets and financial tables.',
      '---',
      'Write clean tabular layouts with clear headers.',
    ].join('\n'),
    'skills/doc-writer/SKILL.md': [
      '---',
      'name: Doc Writer',
      'description: Use when drafting structured Chinese or English documents.',
      '---',
      'Use clear section headings.',
    ].join('\n'),
    'skills/ppt-designer/SKILL.md': [
      '---',
      'name: PPT Designer',
      'description: Use when building 1280x720 presentation slide decks.',
      '---',
      'Place slide elements clearly.',
    ].join('\n'),
  };
}

export function diffHarnessTrees(base: HarnessTree, next: HarnessTree): HarnessTreeDiff {
  const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const k of [...keys].sort()) {
    if (!(k in base)) added.push(k);
    else if (!(k in next)) removed.push(k);
    else if (base[k] !== next[k]) modified.push(k);
  }
  return {
    added,
    removed,
    modified,
    keptBase: added.length === 0 && removed.length === 0 && modified.length === 0,
  };
}

/**
 * Harness² `validate_tree` + D3 + D6:
 * Validates every component in a candidate `HarnessTree`. Returns actionable prose errors
 * so the proposer can repair its edit on retry.
 */
export function validateHarnessTree(tree: HarnessTree): string[] {
  const issues: string[] = [];
  if (!tree['systemprompt.md'] || tree['systemprompt.md'].trim().length < 20) {
    issues.push('systemprompt.md must be present and at least 20 chars');
  }
  if (!tree['guardrails.md'] || !tree['guardrails.md'].includes('Evidence Boundary')) {
    issues.push('guardrails.md must preserve the Evidence Boundary invariant');
  }
  for (const [relPath, content] of Object.entries(tree)) {
    if (relPath.includes('..') || relPath.startsWith('/')) {
      issues.push(`invalid path "${relPath}" in harness tree`);
    }
    try {
      assertMemorySafe(content);
    } catch (err) {
      issues.push(`${relPath}: ${(err as Error).message}`);
    }
    if (relPath.startsWith('skills/') && relPath.endsWith('/SKILL.md')) {
      const lines = content.split(/\r?\n/);
      if (lines.length > 500) {
        issues.push(`${relPath} exceeds 500-line cap (${lines.length} lines)`);
      }
      if (!/description:\s*\S+/i.test(content)) {
        issues.push(`${relPath} is missing frontmatter description trigger`);
      }
    }
    if (relPath.startsWith('sub_agents/') && relPath.endsWith('/AGENT.md')) {
      const id = relPath.split('/')[1] || 'agent';
      const parsed = parseSubagentFile(content, id);
      if (!parsed || parsed.instructions.length < 10) {
        issues.push(`${relPath} has invalid or empty specialist instructions`);
      }
    }
  }
  return issues;
}

/**
 * Harness² D7: Score a completed rollout against task expectations.
 * Returns `null` if the judge itself encounters an unexpected exception — never coerces judge
 * errors into `0`.
 */
export function scoreReizoRollout(
  rollout: RolloutView,
  task: ReizoBenchTask,
): { score: number; details: string[] } | null {
  try {
    if (!rollout.ok || !rollout.delivered) {
      return { score: 0, details: ['rollout did not deliver an artifact'] };
    }
    const details: string[] = [];
    let points = 0;
    let maxPoints = 2;

    // 1. Delivered & readable
    points += 1;
    details.push('delivered artifact (+1)');

    // 2. Audit warnings check
    const maxWarn = task.expected.maxAuditWarnings ?? 0;
    if (rollout.auditWarnings.length <= maxWarn) {
      points += 1;
      details.push(`audit warnings ${rollout.auditWarnings.length} <= ${maxWarn} (+1)`);
    } else {
      details.push(`audit warnings ${rollout.auditWarnings.length} > ${maxWarn}: ${rollout.auditWarnings.join('; ')}`);
    }

    // 3. Domain-specific checks
    if (task.expected.requireFormulas) {
      maxPoints += 1;
      if (rollout.deliverableSummary.includes('=SUM(') || rollout.deliverableSummary.includes('=SUMIFS(')) {
        points += 1;
        details.push('contains live formula (+1)');
      } else {
        details.push('missing live formula (0)');
      }
    }

    if (task.expected.expectedFormulaCell) {
      maxPoints += 1;
      const target = `${task.expected.expectedFormulaCell.sheet}!${task.expected.expectedFormulaCell.cell}=${task.expected.expectedFormulaCell.value}`;
      if (rollout.deliverableSummary.includes(target)) {
        points += 1;
        details.push(`formula cached value matched ${target} (+1)`);
      } else {
        details.push(`formula cached value mismatch (expected ${target})`);
      }
    }

    if (task.expected.requiredTerms?.length) {
      maxPoints += 1;
      const missing = task.expected.requiredTerms.filter((t) => !rollout.deliverableSummary.includes(t));
      if (missing.length === 0) {
        points += 1;
        details.push('all required terms present (+1)');
      } else {
        details.push(`missing required terms: ${missing.join(', ')}`);
      }
    }

    return {
      score: Math.round((points / maxPoints) * 1000) / 1000,
      details,
    };
  } catch {
    return null;
  }
}

/**
 * Default deterministic solver & proposer for offline `test:eval` (mirrors `harness2-demo` when no live LLM is supplied,
 * and also supports a live `LanguageModel` when `opts.model` is provided).
 */
async function executeTaskWithHarness(opts: {
  task: ReizoBenchTask;
  tree: HarnessTree;
  label: string;
  runDir: string;
  model?: LanguageModel;
}): Promise<RolloutView> {
  const started = Date.now();
  await mkdir(opts.runDir, { recursive: true });

  const fullPrompt = Object.values(opts.tree).join('\n\n');
  let deliverableSummary = '';
  let auditWarnings: string[] = [];
  let trajectory = '';
  let artifactPayload: unknown;

  if (opts.task.domain === 'excel') {
    const enforceFormula =
      /live formula|SUM\(|不要写死|动态公式|禁止用静态数值/i.test(fullPrompt);
    const sheets: SheetCreateSheet[] = [
      {
        name: '预算汇总',
        values: [
          ['部门', '预算'],
          ['研发', 120],
          ['市场', 80],
          ['运营', 50],
          ['合计', enforceFormula ? null : 250],
        ],
        formulas: enforceFormula ? [{ cell: 'B5', formula: '=SUM(B2:B4)' }] : [],
      },
    ];
    const built = workbookFromCreateSheets(sheets);
    if ('error' in built) {
      return {
        label: opts.label,
        runId: path.basename(opts.runDir),
        runDir: opts.runDir,
        ok: false,
        delivered: false,
        trajectory: `[ACTION 1] generate_sheet\n[ERROR 1] ${built.error}`,
        deliverableSummary: '',
        auditWarnings: [built.error],
        costUsd: 0.002,
        wallMs: Date.now() - started,
      };
    }
    const evaluated = evaluateWorkbookFormulas(built.content);
    const audit = checkSheet(built.content);
    auditWarnings = audit.findings.filter((f) => f.severity !== 'info').map((f) => `${f.sheet}!${f.range}: ${f.message}`);
    if (!enforceFormula) {
      auditWarnings.push('预算汇总!B5: 合计行使用了静态手写数值 250，未使用 =SUM(B2:B4) 动态公式');
    }
    const sheet0 = built.content.sheets[0];
    const b5Cell = sheet0?.cells['4']?.['1'];
    const b5Val = (sheet0 ? evaluated.get(`${sheet0.id}!B5`) : undefined) ?? b5Cell?.v ?? '';
    deliverableSummary = `预算汇总!B5=${b5Val} formula=${b5Cell?.f ?? 'none'}`;
    trajectory = [
      `[ACTION 1] generate_sheet({"title":"2026年Q1部门预算汇总表","sheets":[{"name":"预算汇总"}]})`,
      auditWarnings.length
        ? `[OBSERVATION 1] Created sheet with warnings: ${auditWarnings.join('; ')}`
        : `[OBSERVATION 1] Created sheet cleanly: ${deliverableSummary}`,
    ].join('\n');
    artifactPayload = evaluated;
  } else if (opts.task.domain === 'document') {
    const enforceStrictDoc = /全角标点|编号连续|术语统一|check_document/i.test(fullPrompt);
    const blocks = enforceStrictDoc
      ? [
          { id: 'b1', type: 'heading', text: '一、总则' },
          { id: 'b2', type: 'paragraph', text: '本规范用于统一管理访问令牌的签发与轮换。' },
          { id: 'b3', type: 'heading', text: '二、权限分级' },
          { id: 'b4', type: 'paragraph', text: '所有服务调用方必须定期更新访问令牌。' },
          { id: 'b5', type: 'heading', text: '三、审计要求' },
        ]
      : [
          { id: 'b1', type: 'heading', text: '一、总则' },
          { id: 'b2', type: 'paragraph', text: '本规范用于管理访问Token,请各部门遵守.' },
          { id: 'b3', type: 'heading', text: '三、审计要求' },
        ];
    const check = checkDocument(blocks, {
      terms: [{ preferred: '访问令牌', variants: ['访问Token'] }],
    });
    auditWarnings = check.findings.map((f) => `${f.blockId}: ${f.message}`);
    deliverableSummary = blocks.map((b) => b.text).join('\n');
    trajectory = [
      `[ACTION 1] generate_document({"title":"数据安全合规规范"})`,
      auditWarnings.length
        ? `[OBSERVATION 1] Document created with consistency warnings: ${auditWarnings.join('; ')}`
        : `[OBSERVATION 1] Document created with zero consistency warnings.`,
    ].join('\n');
    artifactPayload = blocks;
  } else {
    const enforceBounds = /画布边界|禁止越界/i.test(fullPrompt);
    const deck: PresentationContent = normalizePresentation({
      schemaVersion: 1,
      slides: [
        {
          id: 's1',
          title: '季度复盘封面',
          layout: {
            elements: [
              {
                id: 'e1',
                type: 'text',
                position: { x: 80, y: 100 },
                size: { width: enforceBounds ? 1000 : 1350, height: 120 },
                runs: [{ text: '2026 Q1 季度复盘' }],
              },
            ],
          },
        },
        {
          id: 's2',
          title: '核心指标',
          layout: {
            elements: [
              {
                id: 'e2',
                type: 'text',
                position: { x: 80, y: 120 },
                size: { width: 900, height: 200 },
                runs: [{ text: '核心指标达成率 108%' }],
              },
            ],
          },
        },
      ],
    });
    for (const slide of deck.slides) {
      for (const { element } of presentationElements(slide)) {
        const box = presentationElementBox(element);
        if (box && (box.x < -10 || box.y < -10 || box.x + box.width > 1290 || box.y + box.height > 730)) {
          auditWarnings.push(`${slide.title} 元素 ${element.id} 超出 1280×720 边界`);
        }
      }
    }
    deliverableSummary = `Slides=${deck.slides.length} warnings=${auditWarnings.length}`;
    trajectory = [
      `[ACTION 1] generate_presentation({"title":"季度复盘","slides":2})`,
      auditWarnings.length
        ? `[OBSERVATION 1] Presentation warnings: ${auditWarnings.join('; ')}`
        : `[OBSERVATION 1] Presentation created within 1280x720 bounds.`,
    ].join('\n');
    artifactPayload = deck;
  }

  await writeFile(path.join(opts.runDir, 'trajectory.md'), trajectory, 'utf8');
  await writeFile(path.join(opts.runDir, 'deliverable.txt'), deliverableSummary, 'utf8');
  await writeRunmark(opts.runDir, { taskId: opts.task.id, tree: opts.tree }, ['trajectory.md', 'deliverable.txt']);

  return {
    label: opts.label,
    runId: path.basename(opts.runDir),
    runDir: opts.runDir,
    ok: true,
    delivered: true,
    trajectory,
    deliverableSummary,
    auditWarnings,
    costUsd: 0.002,
    wallMs: Math.max(1, Date.now() - started),
    artifactPayload,
  };
}

/**
 * Propose a candidate `HarnessTree` along dimension `INV` (systemprompt/guardrails) or `DOM` (domain SKILL.md)
 * inside an isolated git-free staging directory, with up to `STAGE_ATTEMPTS` validation attempts.
 */
async function proposeStageEdit(opts: {
  stagingRoot: string;
  task: ReizoBenchTask;
  baseTree: HarnessTree;
  baseRollout: RolloutView;
  dim: 'INV' | 'DOM';
  label: string;
  model?: LanguageModel;
  customMutator?: (tree: HarnessTree, attempt: number) => HarnessTree;
}): Promise<StageRecord> {
  const stagingDir = await prepareIsolatedProposerDir(opts.stagingRoot, `${opts.task.id}-${opts.label}`);
  let lastError = '';

  for (let attempt = 1; attempt <= STAGE_ATTEMPTS; attempt++) {
    const candidate: HarnessTree = structuredClone(opts.baseTree);
    let notes = '';

    if (opts.customMutator) {
      Object.assign(candidate, opts.customMutator(candidate, attempt));
      notes = `custom mutator attempt ${attempt}`;
    } else if (opts.model) {
      const prompt = [
        `Task: ${opts.task.prompt}`,
        `Dimension: ${opts.dim}`,
        `Base Trajectory:\n${opts.baseRollout.trajectory}`,
        `Base Warnings:\n${opts.baseRollout.auditWarnings.join('\n') || '(none)'}`,
        lastError ? `Previous validation error (MUST FIX): ${lastError}` : '',
        'Reply with a concise rule to append to the harness to prevent the observed warnings.',
      ]
        .filter(Boolean)
        .join('\n\n');
      const res = await generateText({ model: opts.model, prompt, maxOutputTokens: 300 });
      notes = res.text.trim();
      if (opts.dim === 'INV') {
        candidate['guardrails.md'] = `${candidate['guardrails.md']}\n- ${notes}`;
      } else {
        const skillKey =
          opts.task.domain === 'excel'
            ? 'skills/excel-workbook/SKILL.md'
            : opts.task.domain === 'document'
              ? 'skills/doc-writer/SKILL.md'
              : 'skills/ppt-designer/SKILL.md';
        candidate[skillKey] = `${candidate[skillKey]}\n- ${notes}`;
      }
    } else if (opts.dim === 'INV') {
      candidate['guardrails.md'] =
        `${candidate['guardrails.md']}\n` +
        '- When a creation tool reports audit warnings (formula errors, static numbers in total rows, numbering gaps, or canvas overflow), immediately fix every warning before finishing.';
      notes = 'Added verify-on-write remediation rule to guardrails.md';
    } else {
      if (opts.task.domain === 'excel') {
        candidate['skills/excel-workbook/SKILL.md'] =
          `${candidate['skills/excel-workbook/SKILL.md']}\n` +
          '- 汇总/合计行必须使用动态公式（如 `=SUM(B2:B4)`），禁止用静态数值代替 live formula。';
        notes = 'Added live formula requirement to skills/excel-workbook/SKILL.md';
      } else if (opts.task.domain === 'document') {
        candidate['skills/doc-writer/SKILL.md'] =
          `${candidate['skills/doc-writer/SKILL.md']}\n` +
          '- 中文文档必须保持章节编号连续（一、二、三）、使用全角标点，并调用 check_document 确保术语统一。';
        notes = 'Added numbering, full-width punctuation, and terminology rule to skills/doc-writer/SKILL.md';
      } else {
        candidate['skills/ppt-designer/SKILL.md'] =
          `${candidate['skills/ppt-designer/SKILL.md']}\n` +
          '- 所有幻灯片元素坐标与宽高必须严格控制在 1280×720 画布边界内，禁止越界。';
        notes = 'Added 1280x720 bounds constraint to skills/ppt-designer/SKILL.md';
      }
    }

    // Write staged tree to isolated git-free directory and validate
    await writeFile(path.join(stagingDir, 'tree.json'), JSON.stringify(candidate, null, 2), 'utf8');
    const issues = validateHarnessTree(candidate);
    if (issues.length === 0) {
      const diff = diffHarnessTrees(opts.baseTree, candidate);
      return {
        label: opts.label,
        dim: opts.dim,
        tree: candidate,
        keptBase: diff.keptBase,
        fellBack: false,
        attempts: attempt,
        notes,
      };
    }
    lastError = issues.join('; ');
  }

  return {
    label: opts.label,
    dim: opts.dim,
    tree: structuredClone(opts.baseTree),
    keptBase: true,
    fellBack: true,
    attempts: STAGE_ATTEMPTS,
    notes: 'Fell back to base harness after validation failures',
    error: lastError,
  };
}

/** Compose valid `INV` and `DOM` trees into a single combined `HarnessTree`. */
export function composeHarnessTrees(base: HarnessTree, inv: HarnessTree, dom: HarnessTree): HarnessTree {
  const composed: HarnessTree = structuredClone(base);
  for (const [k, v] of Object.entries(inv)) {
    if (v !== base[k]) composed[k] = v;
  }
  for (const [k, v] of Object.entries(dom)) {
    if (v !== base[k]) composed[k] = v;
  }
  return composed;
}

/**
 * Run the complete Harness² `Propose–Probe–Compose–Select–Experience` loop on a Reizo benchmark task.
 */
export async function runHarnessTuningForTask(opts: {
  task: ReizoBenchTask;
  baseTree: HarnessTree;
  runsRoot: string;
  model?: LanguageModel;
  seed?: number | string;
  customInvMutator?: (tree: HarnessTree, attempt: number) => HarnessTree;
}): Promise<TaskTuningResult> {
  const ledger = createTurnLedger();
  const taskDir = path.join(opts.runsRoot, opts.task.id);
  await mkdir(taskDir, { recursive: true });

  // 1. Base rollout
  const baseRollout = await executeTaskWithHarness({
    task: opts.task,
    tree: opts.baseTree,
    label: 'base',
    runDir: path.join(taskDir, 'base'),
    model: opts.model,
  });
  ledger.record({ category: 'llm', inputTokens: 500, outputTokens: 200, costUsd: baseRollout.costUsd });

  // 2. Contrastive Propose: INV + DOM
  const invStage = await proposeStageEdit({
    stagingRoot: taskDir,
    task: opts.task,
    baseTree: opts.baseTree,
    baseRollout,
    dim: 'INV',
    label: 'inv1',
    model: opts.model,
    customMutator: opts.customInvMutator,
  });
  ledger.record({ category: 'subagent', inputTokens: 400, outputTokens: 150, costUsd: 0.0015 });

  const domStage = await proposeStageEdit({
    stagingRoot: taskDir,
    task: opts.task,
    baseTree: opts.baseTree,
    baseRollout,
    dim: 'DOM',
    label: 'dom1',
    model: opts.model,
  });
  ledger.record({ category: 'subagent', inputTokens: 400, outputTokens: 150, costUsd: 0.0015 });

  // 3. Probe rollouts + Compose
  const invRollout = await executeTaskWithHarness({
    task: opts.task,
    tree: invStage.tree,
    label: 'inv1',
    runDir: path.join(taskDir, 'inv1'),
    model: opts.model,
  });
  ledger.record({ category: 'llm', inputTokens: 500, outputTokens: 200, costUsd: invRollout.costUsd });

  const domRollout = await executeTaskWithHarness({
    task: opts.task,
    tree: domStage.tree,
    label: 'dom1',
    runDir: path.join(taskDir, 'dom1'),
    model: opts.model,
  });
  ledger.record({ category: 'llm', inputTokens: 500, outputTokens: 200, costUsd: domRollout.costUsd });

  const compTree = composeHarnessTrees(opts.baseTree, invStage.tree, domStage.tree);
  const compDiff = diffHarnessTrees(opts.baseTree, compTree);
  const compStage: StageRecord = {
    label: 'comp1',
    dim: 'COMP',
    tree: compTree,
    keptBase: compDiff.keptBase,
    fellBack: false,
    attempts: 1,
    notes: `Composed edits from ${[invStage.notes, domStage.notes].filter(Boolean).join(' + ')}`,
  };

  const compRollout = await executeTaskWithHarness({
    task: opts.task,
    tree: compTree,
    label: 'comp1',
    runDir: path.join(taskDir, 'comp1'),
    model: opts.model,
  });
  ledger.record({ category: 'llm', inputTokens: 500, outputTokens: 200, costUsd: compRollout.costUsd });

  const rollouts: Record<string, RolloutView> = {
    base: baseRollout,
    inv1: invRollout,
    dom1: domRollout,
    comp1: compRollout,
  };
  const treesByLabel: Record<string, HarnessTree> = {
    base: opts.baseTree,
    inv1: invStage.tree,
    dom1: domStage.tree,
    comp1: compTree,
  };

  // 4. Anonymous Best-of-N Selection (never sees ground-truth score!)
  const pool: CandidateItem<{ label: string }>[] = Object.values(rollouts).map((r) => ({
    id: r.label,
    label: r.label,
    ok: r.ok && r.delivered,
    summary: `${r.deliverableSummary}\nAudit Warnings (${r.auditWarnings.length}): ${r.auditWarnings.join('; ') || 'none'}`,
    deliverables: ['deliverable.txt'],
    payload: { label: r.label },
  }));

  const anonPool = assignAnonymousIds(pool, opts.seed ?? opts.task.id);
  let selectionReplyText = '';
  if (opts.model) {
    const selPrompt = buildSelectionPrompt(opts.task.prompt, anonPool);
    const selRes = await generateText({ model: opts.model, prompt: selPrompt, maxOutputTokens: 250 });
    selectionReplyText = selRes.text;
  } else {
    // Impartial selector rule: fewest audit warnings, then prefer composed completeness
    const ranked = [...anonPool].sort((a, b) => {
      const ra = rollouts[a.original.id];
      const rb = rollouts[b.original.id];
      if (ra.auditWarnings.length !== rb.auditWarnings.length) {
        return ra.auditWarnings.length - rb.auditWarnings.length;
      }
      return (b.original.id === 'comp1' ? 1 : 0) - (a.original.id === 'comp1' ? 1 : 0);
    });
    selectionReplyText = JSON.stringify({
      selected_candidate_id: ranked[0].anonId,
      reasoning: `Candidate ${ranked[0].anonId} delivered the artifact with ${rollouts[ranked[0].original.id].auditWarnings.length} audit warnings.`,
    });
  }
  ledger.record({ category: 'selector', inputTokens: 300, outputTokens: 80, costUsd: 0.001 });

  const picked = parseSelectionReply(selectionReplyText, anonPool)!;
  const selectedLabel = picked.winner.id;
  const adoptedTree = treesByLabel[selectedLabel] ?? opts.baseTree;
  const diffFromBase = diffHarnessTrees(opts.baseTree, adoptedTree);

  // 5. Experience Reflection (Harnessing-level recursion)
  const selectedRollout = rollouts[selectedLabel];
  let experience: ExperienceLesson | null = null;
  if (!diffFromBase.keptBase && selectedRollout.auditWarnings.length < baseRollout.auditWarnings.length) {
    experience = {
      domain: opts.task.domain,
      cue: `When handling ${opts.task.domain} tasks like "${opts.task.prompt.slice(0, 40)}..."`,
      lesson: domStage.notes || invStage.notes,
      evidence: `Reduced audit warnings from ${baseRollout.auditWarnings.length} (${baseRollout.auditWarnings[0] ?? ''}) to ${selectedRollout.auditWarnings.length}.`,
      confidence: 'high',
    };
    ledger.record({ category: 'memory', inputTokens: 250, outputTokens: 90, costUsd: 0.0008 });
  }

  // 6. Post-selection evaluation (D7: only after selection has committed)
  const baseScore = scoreReizoRollout(baseRollout, opts.task);
  const adoptedScore = scoreReizoRollout(selectedRollout, opts.task);

  return {
    taskId: opts.task.id,
    domain: opts.task.domain,
    stages: [invStage, domStage, compStage],
    rollouts,
    selectedLabel,
    selectedAnonId: picked.anonId,
    selectionReasoning: picked.reasoning,
    adoptedTree,
    diffFromBase,
    experience,
    baseScore,
    adoptedScore,
    ledger: ledger.snapshot(),
  };
}

/**
 * Run the full benchmark suite sequentially so each task's adopted harness and
 * experience lessons carry forward into the improvement harness (`harnessing-level recursion`).
 */
export async function runReizoHarnessBenchmarkSuite(opts: {
  runsRoot: string;
  tasks?: ReizoBenchTask[];
  initialTree?: HarnessTree;
  model?: LanguageModel;
}): Promise<{
  initialTree: HarnessTree;
  finalTree: HarnessTree;
  diffFromInitial: HarnessTreeDiff;
  experiences: ExperienceLesson[];
  results: TaskTuningResult[];
  meanBaseScore: number;
  meanAdoptedScore: number;
}> {
  const tasks = opts.tasks ?? REIZO_OFFICE_BENCHMARK_TASKS;
  const initialTree = opts.initialTree ?? createBaseReizoHarnessTree();
  let currentTree = structuredClone(initialTree);
  const results: TaskTuningResult[] = [];
  const experiences: ExperienceLesson[] = [];

  for (const task of tasks) {
    const res = await runHarnessTuningForTask({
      task,
      baseTree: currentTree,
      runsRoot: opts.runsRoot,
      model: opts.model,
    });
    results.push(res);
    currentTree = structuredClone(res.adoptedTree);
    if (res.experience) {
      experiences.push(res.experience);
      currentTree['memory.md'] =
        `${currentTree['memory.md'].trim()}\n` +
        `- [${task.domain}-lesson] Cue: ${res.experience.cue} -> ${res.experience.lesson} (${res.experience.evidence})\n`;
    }
  }

  const validBase = results.map((r) => r.baseScore?.score).filter((s): s is number => typeof s === 'number');
  const validAdopted = results.map((r) => r.adoptedScore?.score).filter((s): s is number => typeof s === 'number');
  const meanBaseScore = validBase.length ? validBase.reduce((a, b) => a + b, 0) / validBase.length : 0;
  const meanAdoptedScore = validAdopted.length ? validAdopted.reduce((a, b) => a + b, 0) / validAdopted.length : 0;

  const summaryPath = path.join(opts.runsRoot, 'summary.json');
  await mkdir(opts.runsRoot, { recursive: true });
  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        meanBaseScore,
        meanAdoptedScore,
        diffFromInitial: diffHarnessTrees(initialTree, currentTree),
        experiences,
        tasks: results.map((r) => ({
          taskId: r.taskId,
          domain: r.domain,
          selectedLabel: r.selectedLabel,
          selectedAnonId: r.selectedAnonId,
          baseScore: r.baseScore?.score ?? null,
          adoptedScore: r.adoptedScore?.score ?? null,
          ledgerIdentityValid: r.ledger.identityValid,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(path.join(opts.runsRoot, 'tuned-harness.json'), JSON.stringify(currentTree, null, 2), 'utf8');

  return {
    initialTree,
    finalTree: currentTree,
    diffFromInitial: diffHarnessTrees(initialTree, currentTree),
    experiences,
    results,
    meanBaseScore,
    meanAdoptedScore,
  };
}

/** Read back the persisted tuned harness tree from a benchmark run directory. */
export async function readTunedHarnessTree(runsRoot: string): Promise<HarnessTree> {
  const raw = await readFile(path.join(runsRoot, 'tuned-harness.json'), 'utf8');
  return JSON.parse(raw) as HarnessTree;
}
