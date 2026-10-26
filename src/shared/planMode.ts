/**
 * Plan mode: the session is read-only until the user confirms. The model may read, search and think, and must come
 * back with a step-by-step plan the user can approve; nothing is written, run or sent before that.
 */
export const PLAN_MODE_NOTICE =
  'PLAN MODE is on. You can read and analyse, but writing files, running commands, calling external tools, generating media or creating automations is blocked — those tools are not available. Investigate what you need, then reply with a short numbered plan (what you will change or produce, in order, and anything risky or irreversible) and record it with todo_write so it shows as a checklist. Do not claim anything has been done. End by asking the user to confirm the plan; they will leave plan mode and tell you to go ahead.';

/** What the confirm button sends once plan mode is off. */
export const PLAN_CONFIRM_MESSAGE = '计划已确认，请按计划开始执行。';

/** The effective run ceiling: plan mode forces read-only, otherwise whatever the caller asked for. */
export function ceilingWithPlanMode<T>(ceiling: T | undefined, planMode: boolean): T | 'readonly' | undefined {
  return planMode ? 'readonly' : ceiling;
}
