import { describe, expect, it } from 'vitest';
import { pickNextStepActions } from './nextStep';

describe('pickNextStepActions', () => {
  it('always includes at least the context-free action', () => {
    const a = pickNextStepActions({ hasArtifact: false, hasTextArtifact: false, hasImageArtifact: false });
    expect(a.map((x) => x.id)).toContain('next-steps');
  });

  it('adds artifact actions when an artifact exists', () => {
    const a = pickNextStepActions({ hasArtifact: true, hasTextArtifact: true, hasImageArtifact: false });
    const ids = a.map((x) => x.id);
    expect(ids).toContain('improve-artifact');
    expect(ids).toContain('generate-from-plan');
    expect(ids).not.toContain('variations');
  });

  it('offers variations only for image artifacts', () => {
    const a = pickNextStepActions({ hasArtifact: true, hasTextArtifact: false, hasImageArtifact: true });
    expect(a.map((x) => x.id)).toContain('variations');
  });

  it('caps the number of cards', () => {
    const a = pickNextStepActions(
      { hasArtifact: true, hasTextArtifact: true, hasImageArtifact: true },
      3,
    );
    expect(a.length).toBeLessThanOrEqual(3);
  });
});
