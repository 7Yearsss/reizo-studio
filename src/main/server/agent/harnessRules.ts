import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertMemorySafe } from '../../workspaceMemoryDir';

/**
 * Harness² A2 & A3 + Dynamic Hot-Reloadable Prompt Layer:
 * - Built-in defaults (`EVIDENCE_BOUNDARY_RULE`, `DELIVERABLE_CONFORMANCE_RULE`) provide a safe baseline.
 * - `loadActiveHarnessRules(dataRoot)` dynamically loads evolved overrides/addons from
 *   `<dataRoot>/harness/systemprompt.md` and `<dataRoot>/harness/guardrails.md` on every turn,
 *   so the agent's prompt and guardrails are NOT hardcoded and evolve over time.
 */

export const EVIDENCE_BOUNDARY_RULE =
  'Evidence Boundary Rules:\n' +
  '- Ground every factual claim, number, file reference, and status update in actual tool outputs, workspace files, or user-provided attachments.\n' +
  '- Never fabricate citations, URLs, financial figures, test results, or file contents when a tool fails or returns empty; state clearly what could not be verified.';

export const DELIVERABLE_CONFORMANCE_RULE =
  'Deliverable Conformance Rules:\n' +
  '- Before finishing a turn that produces or edits a deliverable (Excel workbook, Doc, PPT deck, diagram, or workspace file), verify that every requested item, sheet/slide/section, formula, and constraint is present and free of structural errors.\n' +
  '- If a creation or edit tool reports `warnings` (such as formula errors `#REF!`/`#VALUE!`, broken ranges, or slide overflow), fix them before concluding the turn.';

export interface ActiveHarnessRules {
  systemPromptAddon: string;
  guardrails: string;
}

export async function loadActiveHarnessRules(dataRoot?: string): Promise<ActiveHarnessRules> {
  const defaultGuardrails = `${EVIDENCE_BOUNDARY_RULE}\n\n${DELIVERABLE_CONFORMANCE_RULE}`;
  if (!dataRoot) {
    return { systemPromptAddon: '', guardrails: defaultGuardrails };
  }
  const harnessDir = path.join(dataRoot, 'harness');
  const readSafe = async (file: string): Promise<string> => {
    try {
      const text = (await readFile(path.join(harnessDir, file), 'utf8')).trim();
      assertMemorySafe(text);
      return text;
    } catch {
      return '';
    }
  };
  const [customSystem, customGuardrails] = await Promise.all([
    readSafe('systemprompt.md'),
    readSafe('guardrails.md'),
  ]);
  return {
    systemPromptAddon: customSystem,
    guardrails: customGuardrails || defaultGuardrails,
  };
}

export async function saveHarnessRulesOverride(
  dataRoot: string,
  patch: { systemPromptAddon?: string; guardrails?: string },
): Promise<void> {
  const harnessDir = path.join(dataRoot, 'harness');
  await mkdir(harnessDir, { recursive: true });
  if (patch.systemPromptAddon !== undefined) {
    assertMemorySafe(patch.systemPromptAddon);
    await writeFile(path.join(harnessDir, 'systemprompt.md'), `${patch.systemPromptAddon.trim()}\n`, 'utf8');
  }
  if (patch.guardrails !== undefined) {
    assertMemorySafe(patch.guardrails);
    await writeFile(path.join(harnessDir, 'guardrails.md'), `${patch.guardrails.trim()}\n`, 'utf8');
  }
}
