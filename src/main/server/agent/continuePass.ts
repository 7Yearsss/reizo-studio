import type { TodoItem } from '../../../shared/stream';
import type { ToolCallPart } from '../../../shared/chat';

const DELIVERABLE_TOOLS = new Set([
  'generate_file', 'write_file', 'edit_file', 'generate_sheet', 'propose_sheet_edits',
  'generate_document', 'propose_document_edits', 'generate_presentation', 'propose_presentation_edits',
  'generate_diagram', 'generate_image', 'add_node', 'run_node', 'run_graph', 'create_storyboard_pipeline',
]);

/** Inspect the canonical turn snapshot, including SDK tool results, not just side-channel events. */
export function hasDeliveredArtifact(parts: ToolCallPart[]): boolean {
  return parts.some(part => {
    if (!DELIVERABLE_TOOLS.has(part.name) || part.error !== undefined || part.result === undefined) return false;
    if (part.name !== 'generate_file') return true;
    try {
      const result = JSON.parse(part.result);
      return result.ok === true && typeof result.artifactId === 'string' && result.artifactId.length > 0;
    } catch { return false; }
  });
}

/** Extra provider passes after the model first stops with text. Bounded. */
export const MAX_CONTINUE_PASSES = 2;

export const CONTINUE_USER_MESSAGE =
  'Continue. The previous assistant message did not finish the user request. Use tools as needed and deliver the remaining findings now. Do not only restate the plan.';

export type ContinueReason = 'truncated' | 'todos' | 'deferred' | 'undelivered';

/**
 * Harness-side stop check. Other agents (Claude Code, Cline, Cindy) do not
 * treat "the model returned text" as "the product turn is done" when the
 * work is still open — truncated output, open todos, a plan that defers
 * the rest of the job, or an explicit deliverable request where no artifact/file
 * was produced yet (Harness² A6). That decision lives in code, not in the system prompt.
 */
export function shouldContinueAgentPass(input: {
  text: string;
  todos?: Pick<TodoItem, 'status'>[];
  finishReason?: string;
  /** User request text — checked when `delivered === false` to catch undelivered artifacts. */
  userText?: string;
  /** Did this turn produce any deliverable (file write, sheet/doc/ppt/diagram/image/canvas generation)? */
  delivered?: boolean;
}): ContinueReason | null {
  const reason = (input.finishReason ?? '').toLowerCase();
  if (reason === 'length' || reason === 'max_tokens') return 'truncated';
  if (input.todos?.some((item) => item.status === 'pending' || item.status === 'in_progress')) {
    return 'todos';
  }
  if (looksLikeDeferredWork(input.text)) return 'deferred';
  if (
    input.delivered === false &&
    input.userText &&
    looksLikeDeliverableRequest(input.userText) &&
    !asksClarificationQuestion(input.text)
  ) {
    return 'undelivered';
  }
  return null;
}

/** The user explicitly asked to create/generate/export a concrete artifact or file. */
export function looksLikeDeliverableRequest(userText: string): boolean {
  const trimmed = userText.trim();
  if (!trimmed) return false;
  if (/(?:怎么|如何|怎样)|how\s+(?:do|to|can)\s+i\b/i.test(trimmed) && /[?？]|吗/.test(trimmed)) return false;
  const zh =
    /(?:生成|制作|创建|新建|导出|写一(?:份|个|篇)|做一(?:份|个|张))[\s\S]{0,60}?(?:文件|附件|txt|markdown|csv|json|html|\.md\b|表格|工作簿|预算表|Excel|xlsx|文档|报告|Word|docx|PPT|演示稿|幻灯片|流程图|架构图|时序图)/i;
  const en =
    /\b(?:create|generate|build|write|export)\b[\s\S]{0,60}\b(?:file|txt|markdown|csv|json|html|spreadsheet|workbook|xlsx|document|docx|report|presentation|slides|pptx|diagram)\b/i;
  return zh.test(trimmed) || en.test(trimmed);
}

function asksClarificationQuestion(reply: string): boolean {
  const trimmed = reply.trim();
  return /[?？]\s*$/.test(trimmed) || /请(?:问|确认|提供|告诉我)|could you (?:clarify|confirm|specify)/i.test(trimmed);
}

/** The model announced more work instead of doing it. */
export function looksLikeDeferredWork(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 30) return false;
  const defers =
    /我继续|接下来(?:会|我|去)|我再(?:去|核对|检查|看)|初步看|随后会|I(?:'ll| will) (?:continue|check|look|verify|inspect)|let me (?:continue|keep checking|check)/i;
  const concludes = /结论[:：]|总结[:：]|发现如下|修复如下|已完成以下|here's what i found|in conclusion/i;
  return defers.test(trimmed) && !concludes.test(trimmed);
}
