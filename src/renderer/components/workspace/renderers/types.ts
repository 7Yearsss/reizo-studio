import type { Artifact } from '../../../../shared/artifact';

export interface ArtifactRenderProps {
  artifact: Artifact;
  /** The version to show (defaults to `artifact.version`). */
  version: number;
  /** Resolved inline text content for text kinds; '' for blobs. */
  text: string;
  /** Absolute URL for blob kinds (`<img src>` etc.); '' for text. */
  rawUrl: string;
}

export interface ArtifactRendererDef {
  id: string;
  /** True if this renderer can display the given artifact. */
  canRender(artifact: Artifact): boolean;
  supportsStreaming: boolean;
  Component: React.FC<ArtifactRenderProps>;
}
