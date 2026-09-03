import type { Artifact } from '../../../../shared/artifact';

export interface ArtifactRenderProps {
  artifact: Artifact;
  /** The version to show (defaults to `artifact.version`). */
  version: number;
  /** Resolved inline text content for text kinds; '' for blobs. */
  text: string;
  /** Absolute URL for blob kinds (`<img src>` etc.); '' for text. */
  rawUrl: string;
  /**
   * Present when this artifact's latest version is editable in place (a text
   * kind, showing the latest version). Persists a new version.
   */
  onCommitDraft?: (nextText: string) => Promise<void>;
}

export interface ArtifactRendererDef {
  id: string;
  /** True if this renderer can display the given artifact. */
  canRender(artifact: Artifact): boolean;
  supportsStreaming: boolean;
  Component: React.FC<ArtifactRenderProps>;
}
