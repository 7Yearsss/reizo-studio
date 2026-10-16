import { useId, useState } from 'react';
import { DropdownMenu, Tooltip } from 'radix-ui';
import { Check, ChevronDown, Lightbulb, Settings2, X } from 'lucide-react';
import { cn } from '../../lib/cn';

import { GUIDE_CATEGORIES as GUIDES, categorySkills, type GuideTool } from './conversationGuideData';
import type { SkillSummary } from '../../state/skillStore';

export default function ConversationGuide({ disabled, onChoose, onManageSkills, skills = [], selectedToolId }: {
  disabled?: boolean;
  onChoose: (tool: GuideTool) => void;
  skills?: SkillSummary[];
  selectedToolId?: string;
  onManageSkills: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const panelId = useId();
  const category = GUIDES.find((guide) => guide.label === selected);
  const installedTools = category ? categorySkills(category, skills) : [];
  function choose(guide: typeof GUIDES[number]) {
    setSelected((current) => current === guide.label ? null : guide.label);
  }
  function cards(tools: GuideTool[]) {
    return <div className="grid grid-cols-1 gap-2.5 min-[460px]:grid-cols-2 xl:grid-cols-4">
      {tools.map((tool) => (
        <button key={tool.id} type="button" disabled={disabled} aria-pressed={selectedToolId === tool.id} onClick={() => onChoose(tool)} className={cn('min-w-0 rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50', selectedToolId === tool.id ? 'border-ink/30 bg-paper-raised' : 'border-line/80 bg-paper-raised/50 hover:border-ink/25 hover:bg-paper-raised')}>
          <span className="flex items-start justify-between gap-2 text-[13px] font-medium leading-5 text-ink"><span>{tool.label}</span>{selectedToolId === tool.id && <Check size={13} className="shrink-0" />}</span>
          <span className="mt-1.5 block line-clamp-2 text-xs leading-relaxed text-ink-muted">{tool.description}</span>
        </button>
      ))}
    </div>;
  }
  const chip = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50';
  return (
    <Tooltip.Provider delayDuration={180}>
      <div aria-label="新对话引导" className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {GUIDES.slice(0, 6).map((guide, index) => (
          <Tooltip.Root key={guide.label}>
            <Tooltip.Trigger asChild>
              <button type="button" disabled={disabled} onClick={() => choose(guide)} aria-expanded={selected === guide.label} aria-controls={panelId} className={cn(chip, (selected ?? '引导帮助') === guide.label ? 'bg-ink text-paper-raised' : 'bg-paper-inset text-ink-muted hover:text-ink')}>
                {index === 0 && <Lightbulb size={12} />}{guide.label}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side="bottom" sideOffset={8} collisionPadding={16} className="z-[60] max-w-[min(320px,calc(100vw-32px))] rounded-xl border border-line bg-paper-raised px-3 py-2 text-xs leading-relaxed text-ink shadow-lg">
                {guide.description}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        ))}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" disabled={disabled} className={cn(chip, GUIDES.slice(6).some((guide) => guide.label === selected) ? 'bg-ink text-paper-raised' : 'bg-paper-inset text-ink-muted hover:text-ink')}>{GUIDES.slice(6).find((guide) => guide.label === selected)?.label ?? '更多'}<ChevronDown size={12} /></button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={8} className="z-[60] w-64 rounded-xl border border-line bg-paper-raised p-1.5 text-ink shadow-lg">
              {GUIDES.slice(6).map((guide) => (
                <DropdownMenu.Item key={guide.label} onSelect={() => setSelected(guide.label)} className="cursor-pointer rounded-lg p-2 outline-none focus:bg-paper-inset">
                  <div className="text-sm">{guide.label}</div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">{guide.description}</p>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button type="button" disabled={disabled} aria-label="管理技能" onClick={onManageSkills} className={cn(chip, 'bg-paper-inset px-2 text-ink-muted hover:text-ink')}><Settings2 size={14} /></button>
          </Tooltip.Trigger>
          <Tooltip.Portal><Tooltip.Content side="bottom" sideOffset={8} className="z-[60] rounded-lg border border-line bg-paper-raised px-3 py-2 text-xs text-ink shadow-lg">管理已安装的技能</Tooltip.Content></Tooltip.Portal>
        </Tooltip.Root>
      </div>
      {category && (
        <section id={panelId} aria-label={`${category.label}工具`} className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-medium">{category.label}<span className="ml-2 text-xs font-normal text-ink-muted">选择工具，编辑后发送</span></h2>
            <button type="button" disabled={disabled} aria-label="收起分类工具" onClick={() => setSelected(null)} className="rounded-md p-1 text-ink-muted hover:bg-paper-inset focus-visible:outline-2 focus-visible:outline-accent"><X size={14} /></button>
          </div>
          {cards(category.tools)}
          {installedTools.length > 0 && <>
            <h3 className="mb-2 mt-4 text-[11px] text-ink-muted">已安装技能 · {installedTools.length}</h3>
            <div className="max-h-52 overflow-y-auto p-0.5">{cards(installedTools)}</div>
          </>}
        </section>
      )}
    </Tooltip.Provider>
  );
}
