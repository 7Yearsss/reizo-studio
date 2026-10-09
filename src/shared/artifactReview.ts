import type { ArtifactKind, ArtifactOrigin } from './artifact';

export type ReviewDecision = 'accept' | 'reject';
export interface ArtifactReviewChange {
  id: string;
  label: string;
  operation: unknown;
  before: string;
  after: string;
  status: 'pending' | 'accepted' | 'rejected';
  decidedAt?: string;
  acceptedVersion?: number;
  editedByUserAt?: string;
}
export interface ArtifactReview {
  id: string;
  artifactId: string;
  sessionId: string;
  kind: ArtifactKind;
  initialVersion: number;
  baseVersion: number;
  reviewVersion: number;
  baseContent: string;
  candidateContent: string;
  changes: ArtifactReviewChange[];
  origin: ArtifactOrigin;
  status: 'pending' | 'partial' | 'accepted' | 'rejected';
  stale: boolean;
  createdAt: string;
  updatedAt: string;
}
