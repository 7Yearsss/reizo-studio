import { describe, expect, it } from 'vitest';
import {
  assignAnonymousIds,
  buildSelectionPrompt,
  filterValidCandidates,
  parseSelectionReply,
  type CandidateItem,
} from './candidateSelection';

describe('candidateSelection (Harness² C1–C3)', () => {
  const raw: CandidateItem[] = [
    { id: 'node_1', label: 'Model-A', summary: '', deliverables: [], ok: true },
    { id: 'node_2', label: 'Model-B', summary: 'Failed run', ok: false },
    { id: 'node_3', label: 'Model-C', summary: 'Complete budget table with SUMIFS', deliverables: ['budget.xlsx'] },
    { id: 'node_4', label: 'Model-D', summary: 'Partial draft without formulas', deliverables: ['draft.xlsx'] },
  ];

  it('filters out empty or failed candidates before selection', () => {
    const valid = filterValidCandidates(raw);
    expect(valid.map((c) => c.id)).toEqual(['node_3', 'node_4']);
  });

  it('assigns deterministic anonymous cand_a/cand_b IDs and strips model labels from prompt', () => {
    const anon1 = assignAnonymousIds(raw, 'seed-123');
    const anon2 = assignAnonymousIds(raw, 'seed-123');
    expect(anon1.map((a) => a.anonId)).toEqual(['cand_a', 'cand_b']);
    expect(anon1.map((a) => a.original.id)).toEqual(anon2.map((a) => a.original.id));

    const prompt = buildSelectionPrompt('Create a budget workbook', anon1);
    expect(prompt).toContain('cand_a');
    expect(prompt).toContain('cand_b');
    expect(prompt).not.toContain('Model-C');
    expect(prompt).not.toContain('Model-D');

    const targetAnon = anon1.find((a) => a.original.id === 'node_3')!;
    const picked = parseSelectionReply(
      `{"selected_candidate_id": "${targetAnon.anonId}", "reasoning": "Has live SUMIFS formulas"}`,
      anon1,
    );
    expect(picked?.winner.id).toBe('node_3');
    expect(picked?.reasoning).toContain('SUMIFS');
  });
});
