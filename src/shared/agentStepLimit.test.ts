import { describe, expect, it } from 'vitest';
import { AGENT_STEP_LIMIT_OPTIONS, DEFAULT_AGENT_STEP_LIMIT, normalizeAgentStepLimit } from './settings';

describe('normalizeAgentStepLimit', () => {
  it('keeps sane whole numbers and falls back for everything else', () => {
    for (const option of AGENT_STEP_LIMIT_OPTIONS) expect(normalizeAgentStepLimit(option)).toBe(option);
    for (const bad of [undefined, null, 0, 7, 1001, 12.5, '64', NaN]) expect(normalizeAgentStepLimit(bad)).toBe(DEFAULT_AGENT_STEP_LIMIT);
  });
});
