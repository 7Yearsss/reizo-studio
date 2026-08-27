import type { SkillSummary } from '../../state/skillStore';
import * as tabStore from '../../state/tabStore';

export interface SlashCommand {
  id: string;
  name: string;
  description: string;
  kind: 'builtin' | 'skill';
}

export function extractSlashQuery(text: string): string | null {
  const match = text.match(/^\/([^\s]*)$/);
  return match ? match[1] : null;
}

export function buildSlashCommands(skills: SkillSummary[]): SlashCommand[] {
  return [
    { id: 'new', name: 'new', description: '打开新对话', kind: 'builtin' },
    { id: 'settings', name: 'settings', description: '打开设置', kind: 'builtin' },
    ...skills.map((skill) => ({
      id: skill.id,
      name: skill.id,
      description: skill.description || skill.name,
      kind: 'skill' as const,
    })),
  ];
}

export default function SlashPalette({
  query,
  commands,
  onPick,
}: {
  query: string;
  commands: SlashCommand[];
  onPick: (command: SlashCommand) => void;
}) {
  const filtered = commands.filter((cmd) => cmd.name.includes(query.toLowerCase()) || cmd.description.includes(query));
  if (filtered.length === 0) return null;

  return (
    <div className="absolute right-0 bottom-full left-0 mb-2 overflow-hidden rounded-2xl border border-line bg-paper-raised shadow-[0_8px_30px_rgba(28,22,18,0.08)]">
      {filtered.slice(0, 10).map((cmd) => (
        <button
          key={cmd.id}
          type="button"
          onClick={() => {
            if (cmd.id === 'new') {
              tabStore.newLauncherTab();
              return;
            }
            if (cmd.id === 'settings') {
              tabStore.openSettingsTab();
              return;
            }
            onPick(cmd);
          }}
          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-paper-inset/70"
        >
          <span className="font-mono text-sm text-ink">/{cmd.name}</span>
          <span className="flex-1 truncate text-xs text-ink-muted">{cmd.description}</span>
          <span className="text-[10px] text-ink-muted">{cmd.kind === 'skill' ? 'skill' : ''}</span>
        </button>
      ))}
    </div>
  );
}
