import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { pickNextStepActions, type NextStepContext } from '../../../shared/nextStep';
import { useArtifactStore } from '../../state/useArtifactStore';

export default function NextStepStrip({
  sessionId,
  onPick,
}: {
  sessionId: string;
  onPick: (prompt: string) => void;
}) {
  const artifacts = useArtifactStore((s) => s.bySession[sessionId]) ?? [];

  const ctx: NextStepContext = useMemo(
    () => ({
      hasArtifact: artifacts.length > 0,
      hasTextArtifact: artifacts.some((a) => a.kind === 'markdown' || a.kind === 'text'),
      hasImageArtifact: artifacts.some((a) => a.kind === 'image'),
    }),
    [artifacts],
  );

  const actions = useMemo(() => pickNextStepActions(ctx), [ctx]);
  if (actions.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[10px] text-ink-muted">
        <Sparkles size={11} /> 下一步
      </span>
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onPick(a.prompt)}
          title={a.hint}
          className="rounded-full border border-line bg-paper px-2.5 py-1 text-[11px] text-ink transition-colors hover:bg-paper-inset"
        >
          {a.title}
        </button>
      ))}
    </div>
  );
}
