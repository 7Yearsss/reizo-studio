// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolCallPart } from '../../../shared/chat';

const harness = vi.hoisted(() => ({
  review: {
    id: 'r1', artifactId: 'a1', reviewVersion: 1,
    changes: [{ id: 'c1', label: '改写', before: '不需要再竞聘；', after: '本次不再开放竞聘；', status: 'pending' }],
  },
  decide: vi.fn(async () => ({ artifact: { id: 'a1', version: 3 } })),
}));
vi.mock('../../api', () => ({
  listArtifactReviews: async () => [harness.review],
  decideArtifactReview: harness.decide,
}));
vi.mock('../../state/artifactStore', () => ({ upsertArtifact: vi.fn() }));

import ReviewProposalCard, { reviewProposalOf } from './ReviewProposalCard';

const part = (name: string, result?: string): ToolCallPart => ({ type: 'tool', id: 't', name, args: {}, result });

describe('reviewProposalOf', () => {
  it('only reads a successful propose_*_edits result', () => {
    const ok = JSON.stringify({ ok: true, artifactId: 'a1', reviewId: 'r1' });
    expect(reviewProposalOf(part('propose_document_edits', ok))).toEqual({ artifactId: 'a1', reviewId: 'r1', toolName: 'propose_document_edits' });
    expect(reviewProposalOf(part('propose_sheet_edits', ok))?.toolName).toBe('propose_sheet_edits');
    expect(reviewProposalOf(part('propose_document_edits'))).toBeNull();
    expect(reviewProposalOf(part('propose_document_edits', JSON.stringify({ ok: false, error: 'x' })))).toBeNull();
    expect(reviewProposalOf(part('read_document', ok))).toBeNull();
  });
});

describe('ReviewProposalCard', () => {
  let root: ReturnType<typeof createRoot> | undefined;
  afterEach(() => { act(() => root?.unmount()); harness.decide.mockClear(); });

  it('marks only the changed words and accepts from the chat', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root!.render(<ReviewProposalCard proposal={{ artifactId: 'a1', reviewId: 'r1', toolName: 'propose_document_edits' }} />); });
    expect(host.querySelector('del')?.textContent).toBe('不需要再');
    expect(host.querySelector('ins')?.textContent).toBe('本次不再开放');
    expect(host.textContent).toContain('1 处待审核');
    const accept = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('接受'))!;
    await act(async () => { accept.click(); });
    expect(harness.decide).toHaveBeenCalledWith('a1', 'r1', 1, ['c1'], 'accept');
  });

  it('shows no accept/reject for editors that cannot follow a chat decision', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root!.render(<ReviewProposalCard proposal={{ artifactId: 'a1', reviewId: 'r1', toolName: 'propose_presentation_edits' }} />); });
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('接受'))).toBe(false);
  });
});
