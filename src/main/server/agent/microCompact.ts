import { clipToolOutput, TOOL_OUTPUT_CLIP_CHARS } from './modelHistory';

/**
 * L1: Per-tool character budgets (inspired by Claude Code's toolResultBudget).
 * Tools with bulky structured payloads (grep, list_dir, find_files) get tight
 * limits so the context is not overwhelmed with repetitive listings.
 */
export const TOOL_OUTPUT_BUDGETS: Record<string, number> = {
  grep: 3_000,
  find_files: 3_000,
  list_dir: 4_000,
  read_file: 6_000,
  run_command: 4_000,
  memory_read: 4_000,
};

/**
 * Gets the configured character budget for a specific tool.
 * Falls back to TOOL_OUTPUT_CLIP_CHARS (8,000) if no tool-specific budget exists.
 */
export function getToolOutputBudget(name: string): number {
  return TOOL_OUTPUT_BUDGETS[name] ?? TOOL_OUTPUT_CLIP_CHARS;
}

/**
 * L3: Micro-compaction (inspired by Claude Code's microCompact).
 * Selectively shrinks specific bulky tool results into condensed forms when
 * they exceed their budget, while preserving the most useful information.
 * Falls back to character truncation for other tools.
 *
 * @param name - The name of the tool
 * @param result - The raw tool execution result string
 * @param maxChars - Optional override for character budget
 * @returns The compacted tool result
 */
export function microCompactToolResult(name: string, result: string, maxChars?: number): string {
  if (!result) return result;
  const limit = maxChars ?? getToolOutputBudget(name);

  try {
    if (name === 'grep') {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed) && parsed.length > 15) {
        const kept = parsed.slice(0, 15);
        const omitted = parsed.length - 15;
        kept.push({ summary: `... and ${omitted} more matches` });
        return JSON.stringify(kept);
      }
    }

    if (name === 'find_files') {
      const parsed = JSON.parse(result);
      if (parsed && Array.isArray(parsed.entries) && parsed.entries.length > 20) {
        const kept = parsed.entries.slice(0, 20);
        const omitted = parsed.entries.length - 20;
        return JSON.stringify({
          entries: kept,
          summary: `... and ${omitted} more files`,
        });
      }
      if (Array.isArray(parsed) && parsed.length > 20) {
        const kept = parsed.slice(0, 20);
        const omitted = parsed.length - 20;
        kept.push({ summary: `... and ${omitted} more files` });
        return JSON.stringify(kept);
      }
    }

    if (name === 'list_dir') {
      const parsed = JSON.parse(result);
      if (parsed && Array.isArray(parsed.entries) && parsed.entries.length > 30) {
        const kept = parsed.entries.slice(0, 30);
        const omitted = parsed.entries.length - 30;
        return JSON.stringify({
          ...parsed,
          entries: kept,
          summary: `... and ${omitted} more entries`,
        });
      }
      if (Array.isArray(parsed) && parsed.length > 30) {
        const kept = parsed.slice(0, 30);
        const omitted = parsed.length - 30;
        kept.push({ summary: `... and ${omitted} more entries` });
        return JSON.stringify(kept);
      }
    }

    if (name === 'read_file') {
      if (result.length > limit) {
        const first = result.slice(0, 2000);
        const last = result.slice(-500);
        const omitted = result.length - 2500;
        return `${first}\n[... ${omitted} chars omitted ...]\n${last}`;
      }
    }

    if (name === 'run_command') {
      const parsed = JSON.parse(result);
      if (parsed && typeof parsed === 'object') {
        let modified = false;
        let stdout = parsed.stdout;
        let stderr = parsed.stderr;

        if (typeof stdout === 'string' && stdout.length > 2_000) {
          const first = stdout.slice(0, 1500);
          const last = stdout.slice(-500);
          const omitted = stdout.length - 2000;
          stdout = `${first}\n[... ${omitted} chars omitted ...]\n${last}`;
          modified = true;
        }

        if (typeof stderr === 'string' && stderr.length > 500) {
          stderr = `${stderr.slice(0, 500)}\n[... ${stderr.length - 500} chars omitted ...]`;
          modified = true;
        }

        if (modified) {
          return JSON.stringify({ ...parsed, stdout, stderr });
        }
      }
    }

    if (name === 'generate_image') {
      const parsed = JSON.parse(result);
      if (parsed && typeof parsed === 'object') {
        const { dataUrl: _omitted, ...rest } = parsed as { dataUrl?: string };
        return JSON.stringify(rest);
      }
    }
  } catch {
    // Non-JSON or parsing error - fall through to clipToolOutput
  }

  return clipToolOutput(result, limit);
}
