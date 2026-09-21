import { describe, expect, it } from 'vitest';
import { computeRecommendedAnswers } from './askAutoResolve';
import type { AskQuestion } from './stream';

const q = (over: Partial<AskQuestion>): AskQuestion => ({ id: 'q1', prompt: 'p', ...over });

describe('computeRecommendedAnswers', () => {
  it('resolves options, directions, and free text', () => {
    const questions: AskQuestion[] = [
      q({ options: ['a', 'b'], recommended: 'b' }),
      q({
        id: 'q2',
        kind: 'direction',
        directions: [
          { id: 'warm', title: 'Warm' },
          { id: 'cool', title: 'Cool' },
        ],
        recommended: 'warm',
      }),
      q({ id: 'q3', kind: 'text', recommended: 'hello' }),
    ];
    expect(computeRecommendedAnswers(questions)).toEqual({ q1: 'b', q2: 'warm', q3: 'hello' });
  });

  it('returns null when any question lacks a recommendation', () => {
    expect(computeRecommendedAnswers([q({ options: ['a'], recommended: 'a' }), q({ id: 'q2', options: ['x'] })])).toBeNull();
  });

  it('rejects a recommended value that is not a listed option', () => {
    expect(computeRecommendedAnswers([q({ options: ['a', 'b'], recommended: 'c' })])).toBeNull();
  });

  it('rejects a recommended direction id not in the cards', () => {
    expect(
      computeRecommendedAnswers([
        q({ kind: 'direction', directions: [{ id: 'a', title: 'A' }], recommended: 'b' }),
      ]),
    ).toBeNull();
  });

  it('never auto-resolves multi-select or empty questions', () => {
    expect(computeRecommendedAnswers([q({ options: ['a'], recommended: 'a', multi: true })])).toBeNull();
    expect(computeRecommendedAnswers([])).toBeNull();
    expect(computeRecommendedAnswers([q({ recommended: '  ' })])).toBeNull();
  });
});
