import type { Artifact } from '../../../../shared/artifact';
import type { ArtifactRendererDef, ArtifactRenderProps } from './types';
import MarkdownRenderer from './MarkdownRenderer';

const HtmlRenderer: React.FC<ArtifactRenderProps> = ({ artifact, text }) => (
  // `sandbox=""` blocks scripts entirely, which is the safe default for a
  // static preview. When a "run" mode is added (AP3) it switches to
  // `sandbox="allow-scripts"` and wraps `text` with `withHtmlPreviewGuard`
  // (see ./htmlGuards) to neutralise focus-steal / reload-loop / storage
  // throws.
  <iframe
    title={artifact.name}
    sandbox=""
    className="h-full min-h-[160px] w-full bg-paper-raised"
    srcDoc={text}
  />
);

const ImageRenderer: React.FC<ArtifactRenderProps> = ({ artifact, text, rawUrl }) => {
  const src = rawUrl || (text.startsWith('data:') || text.startsWith('http') ? text : '');
  if (!src) return <Empty label="（无图片数据）" />;
  return (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-3">
      <img src={src} alt={artifact.name} className="max-w-full rounded" />
    </div>
  );
};

const SvgRenderer: React.FC<ArtifactRenderProps> = ({ artifact, text }) => (
  <div
    className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3 [&>svg]:max-w-full"
    // SVG artifacts are authored by the agent / user; same trust level as HTML
    // previews which already use srcDoc. Render inline for crisp scaling.
    dangerouslySetInnerHTML={{ __html: text }}
    aria-label={artifact.name}
  />
);

const VideoRenderer: React.FC<ArtifactRenderProps> = ({ rawUrl, text }) => {
  const src = rawUrl || text;
  if (!src) return <Empty label="（无视频数据）" />;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-black/80 p-2">
      <video src={src} controls playsInline preload="metadata" className="max-h-full max-w-full" />
    </div>
  );
};

const AudioRenderer: React.FC<ArtifactRenderProps> = ({ rawUrl, text }) => {
  const src = rawUrl || text;
  if (!src) return <Empty label="（无音频数据）" />;
  return (
    <div className="flex items-center justify-center p-6">
      <audio src={src} controls preload="metadata" className="w-full" />
    </div>
  );
};

const CodeRenderer: React.FC<ArtifactRenderProps> = ({ text }) => (
  <pre className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-5 whitespace-pre">
    {text || '（空）'}
  </pre>
);

const RawRenderer: React.FC<ArtifactRenderProps> = ({ text }) => (
  <pre className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all">
    {text || '（空）'}
  </pre>
);

function Empty({ label }: { label: string }) {
  return <p className="px-3 py-6 text-xs text-ink-muted">{label}</p>;
}

const REGISTRY: ArtifactRendererDef[] = [
  { id: 'image', canRender: (a) => a.renderer === 'image' || a.kind === 'image', supportsStreaming: false, Component: ImageRenderer },
  { id: 'video', canRender: (a) => a.renderer === 'video' || a.kind === 'video', supportsStreaming: false, Component: VideoRenderer },
  { id: 'audio', canRender: (a) => a.renderer === 'audio' || a.kind === 'audio', supportsStreaming: false, Component: AudioRenderer },
  { id: 'svg', canRender: (a) => a.renderer === 'svg' || a.kind === 'svg', supportsStreaming: true, Component: SvgRenderer },
  { id: 'html', canRender: (a) => a.renderer === 'html' || a.kind === 'html', supportsStreaming: true, Component: HtmlRenderer },
  { id: 'markdown', canRender: (a) => a.renderer === 'markdown' || a.kind === 'markdown' || a.kind === 'text', supportsStreaming: true, Component: MarkdownRenderer },
  { id: 'code', canRender: (a) => a.renderer === 'code' || a.kind === 'code' || a.kind === 'json', supportsStreaming: true, Component: CodeRenderer },
  { id: 'raw', canRender: () => true, supportsStreaming: true, Component: RawRenderer },
];

export function pickRenderer(artifact: Artifact): ArtifactRendererDef {
  return (
    REGISTRY.find((r) => r.id === artifact.renderer && r.canRender(artifact)) ??
    REGISTRY.find((r) => r.canRender(artifact)) ??
    REGISTRY[REGISTRY.length - 1]
  );
}

export function rendererIsBlob(artifact: Artifact): boolean {
  const r = pickRenderer(artifact).id;
  return r === 'image' || r === 'video' || r === 'audio';
}
