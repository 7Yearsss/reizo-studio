import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Command as CommandIcon, PlusCircle, Settings, Wrench } from 'lucide-react';
import type { SkillSummary } from '../../state/skillStore';
import * as tabStore from '../../state/tabStore';
import * as uiStore from '../../state/uiStore';
import { cn } from '../../lib/cn';

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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const filtered = commands
    .filter((cmd) => cmd.name.includes(query.toLowerCase()) || cmd.description.includes(query))
    .slice(0, 10);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (filtered.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((idx) => (idx + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((idx) => (idx - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        const cmd = filtered[selectedIndex];
        if (cmd) {
          e.preventDefault();
          executeCommand(cmd);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [filtered, selectedIndex]);

  if (filtered.length === 0) return null;

  function executeCommand(cmd: SlashCommand) {
    if (cmd.id === 'new') {
      uiStore.setMode('chat');
      tabStore.newLauncherTab();
      return;
    }
    if (cmd.id === 'settings') {
      uiStore.setMode('settings');
      return;
    }
    onPick(cmd);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className="absolute right-0 bottom-full left-0 mb-2 overflow-hidden rounded-2xl border border-line bg-paper-raised p-1 shadow-[0_16px_36px_rgba(28,22,18,0.12)] backdrop-blur-xl"
    >
      <div className="flex flex-col gap-0.5">
        {filtered.map((cmd, idx) => {
          const isSelected = idx === selectedIndex;
          const icon =
            cmd.id === 'new' ? (
              <PlusCircle size={14} className="text-accent" />
            ) : cmd.id === 'settings' ? (
              <Settings size={14} className="text-ink-muted" />
            ) : cmd.kind === 'skill' ? (
              <Wrench size={14} className="text-accent" />
            ) : (
              <CommandIcon size={14} className="text-ink-muted" />
            );

          return (
            <button
              key={cmd.id}
              type="button"
              onMouseEnter={() => setSelectedIndex(idx)}
              onClick={() => executeCommand(cmd)}
              className={cn(
                'relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors',
                isSelected ? 'text-ink' : 'text-ink-muted hover:text-ink',
              )}
            >
              {isSelected && (
                <motion.div
                  layoutId="slash-palette-active-pill"
                  className="absolute inset-0 rounded-xl bg-paper-inset/70"
                  transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                />
              )}
              <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-paper-inset/60">
                {icon}
              </span>
              <span className="relative z-10 font-mono text-sm font-medium text-ink">/{cmd.name}</span>
              <span className="relative z-10 flex-1 truncate text-xs text-ink-muted">{cmd.description}</span>
              <span className="relative z-10 rounded-md bg-paper-inset/80 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                {cmd.kind === 'skill' ? '技能' : '内置'}
              </span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
