import { describe, expect, it } from 'vitest';
import { createComputerBudget, isActingStep } from './computerUse';

const click = { action: 'left_click', x: 1, y: 1 } as const;
const shot = { action: 'screenshot' } as const;

describe('computer budget', () => {
  it('blocks step 31, not before; looking is free', () => {
    const budget = createComputerBudget();
    for (let i = 0; i < 100; i++) budget.charge(shot);
    for (let i = 0; i < 30; i++) budget.charge(click);
    expect(() => budget.charge(click)).toThrow('30 步上限');
    expect(() => budget.charge(shot)).not.toThrow();
  });
  it('the deadline is fixed at the first acting step and cannot be reset', () => {
    let t = 1_000;
    const budget = createComputerBudget({ maxMs: 5 * 60_000, now: () => t });
    t += 60 * 60_000; // time passing before the first acting step does not start the clock
    budget.charge(click);
    t += 4 * 60_000;
    expect(() => budget.charge(click)).not.toThrow();
    t += 2 * 60_000;
    expect(() => budget.charge(click)).toThrow('5 分钟上限');
  });
  it('classifies acting steps', () => {
    expect(isActingStep(click)).toBe(true);
    expect(isActingStep({ action: 'type', text: 'x' })).toBe(true);
    expect(isActingStep(shot)).toBe(false);
    expect(isActingStep({ action: 'wait' })).toBe(false);
  });
});
