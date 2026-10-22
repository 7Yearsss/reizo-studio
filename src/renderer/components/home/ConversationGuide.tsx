import { forwardRef, useId, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { DropdownMenu, Tooltip } from 'radix-ui';
import { Check, ChevronDown, Lightbulb, Settings2, X } from 'lucide-react';
import { cn } from '../../lib/cn';

import { GUIDE_CATEGORIES as GUIDES, categorySkills, type GuideCategory, type GuideTool } from './conversationGuideData';
import type { SkillSummary } from '../../state/skillStore';

const settle = { type: 'spring' as const, stiffness: 500, damping: 38, mass: 0.7 };
const easeOut = [0.22, 1, 0.36, 1] as const;

const GuidePanel = forwardRef<HTMLElement, {
  category: GuideCategory;
  panelId: string;
  skills: SkillSummary[];
  disabled?: boolean;
  selectedToolId?: string;
  onChoose: (tool: GuideTool) => void;
  onClose: () => void;
  reduce: boolean;
}>(function GuidePanel({ category, panelId, skills, disabled, selectedToolId, onChoose, onClose, reduce }, ref) {
  const present = useIsPresent();
  const installedTools = categorySkills(category, skills);
  function cards(tools: GuideTool[]) {
    return <div className="grid grid-cols-1 gap-2.5 min-[460px]:grid-cols-2 xl:grid-cols-4">
      {tools.map((tool) => (
        <motion.button
          key={tool.id} type="button" disabled={disabled || !present}
          aria-pressed={selectedToolId === tool.id} onClick={() => onChoose(tool)}
          variants={{ hidden: { opacity: reduce ? 1 : 0, y: reduce ? 0 : 6 }, visible: { opacity: 1, y: 0, transition: { duration: reduce ? 0 : 0.2, ease: easeOut } } }}
          whileHover={reduce || disabled ? undefined : { y: -2 }}
          whileTap={reduce || disabled ? undefined : { scale: 0.985 }}
          transition={{ duration: 0.16, ease: easeOut }}
          className={cn('min-w-0 rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50', selectedToolId === tool.id ? 'border-ink/30 bg-paper-raised' : 'border-line/80 bg-paper-raised/50 hover:border-ink/25 hover:bg-paper-raised')}
        >
          <span className="flex items-start justify-between gap-2 text-[13px] font-medium leading-5 text-ink"><span>{tool.label}</span>{selectedToolId === tool.id && <Check size={13} className="shrink-0" />}</span>
          <span className="mt-1.5 block line-clamp-2 text-xs leading-relaxed text-ink-muted">{tool.description}</span>
        </motion.button>
      ))}
    </div>;
  }
  return (
    <motion.section
      ref={ref} id={present ? panelId : undefined} aria-label={present ? `${category.label}工具` : undefined}
      aria-hidden={!present || undefined} inert={!present}
      initial="hidden" animate="visible" exit="exit"
      variants={{
        hidden: { opacity: reduce ? 1 : 0, y: reduce ? 0 : 5 },
        visible: { opacity: 1, y: 0, transition: { duration: reduce ? 0 : 0.18, ease: easeOut, staggerChildren: reduce ? 0 : 0.025 } },
        exit: { opacity: 0, y: reduce ? 0 : -3, transition: { duration: reduce ? 0 : 0.09 } },
      }}
      className="pb-1 pt-5"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium">{category.label}<span className="ml-2 text-xs font-normal text-ink-muted">选择工具，编辑后发送</span></h2>
        <motion.button type="button" disabled={disabled || !present} aria-label="收起分类工具" onClick={onClose} whileTap={reduce ? undefined : { scale: 0.9 }} className="rounded-md p-1 text-ink-muted transition-colors hover:bg-paper-inset focus-visible:outline-2 focus-visible:outline-accent"><X size={14} /></motion.button>
      </div>
      {cards(category.tools)}
      {installedTools.length > 0 && <>
        <h3 className="mb-2 mt-4 text-[11px] text-ink-muted">已安装技能 · {installedTools.length}</h3>
        <div className="max-h-52 overflow-y-auto p-0.5">{cards(installedTools)}</div>
      </>}
    </motion.section>
  );
});

export default function ConversationGuide({ disabled, onChoose, onManageSkills, skills = [], selectedToolId }: {
  disabled?: boolean;
  onChoose: (tool: GuideTool) => void;
  skills?: SkillSummary[];
  selectedToolId?: string;
  onManageSkills: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion() ?? false;
  const panelId = useId();
  const category = GUIDES.find((guide) => guide.label === selected);
  const moreCategory = GUIDES.slice(6).find((guide) => guide.label === selected);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!selected || !panel) { setPanelHeight(0); return; }
    const measure = () => setPanelHeight(panel.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [selected]);

  function choose(guide: typeof GUIDES[number]) {
    setSelected((current) => current === guide.label ? null : guide.label);
  }
  function selection(active: boolean) {
    return active && <motion.span aria-hidden="true" layoutId={reduce ? undefined : 'guide-selection'} transition={settle} className="pointer-events-none absolute inset-0 rounded-full bg-ink" />;
  }
  const chip = 'relative inline-flex items-center gap-1.5 rounded-full bg-paper-inset px-3 py-1.5 text-[13px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50';
  return (
    <Tooltip.Provider delayDuration={180}>
      <LayoutGroup id={panelId}>
      <div aria-label="新对话引导" className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {GUIDES.slice(0, 6).map((guide, index) => (
          <Tooltip.Root key={guide.label}>
            <Tooltip.Trigger asChild>
              <motion.button type="button" disabled={disabled} onClick={() => choose(guide)} aria-expanded={selected === guide.label} aria-controls={panelId} whileTap={reduce ? undefined : { scale: 0.95 }} className={cn(chip, (selected ?? '引导帮助') === guide.label ? 'text-paper-raised' : 'text-ink-muted hover:text-ink')}>
                {selection((selected ?? '引导帮助') === guide.label)}
                <span className="relative z-10 inline-flex items-center gap-1.5">{index === 0 && <Lightbulb size={12} />}{guide.label}</span>
              </motion.button>
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
            <button type="button" disabled={disabled} className={cn(chip, 'group transition-[color,transform] active:scale-95 motion-reduce:transform-none', moreCategory ? 'text-paper-raised' : 'text-ink-muted hover:text-ink')}>
              {selection(!!moreCategory)}
              <span className="relative z-10 inline-flex items-center gap-1.5">{moreCategory?.label ?? '更多'}<ChevronDown size={12} className="transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none" /></span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={8} className="z-[60] w-64 origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-xl border border-line bg-paper-raised p-1.5 text-ink shadow-lg duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 motion-reduce:animate-none">
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
            <motion.button type="button" disabled={disabled} aria-label="管理技能" onClick={onManageSkills} whileTap={reduce ? undefined : { scale: 0.9 }} className={cn(chip, 'px-2 text-ink-muted hover:text-ink')}><Settings2 size={14} /></motion.button>
          </Tooltip.Trigger>
          <Tooltip.Portal><Tooltip.Content side="bottom" sideOffset={8} className="z-[60] rounded-lg border border-line bg-paper-raised px-3 py-2 text-xs text-ink shadow-lg">管理已安装的技能</Tooltip.Content></Tooltip.Portal>
        </Tooltip.Root>
      </div>
      <motion.div initial={false} animate={{ height: panelHeight }} transition={{ duration: reduce ? 0 : 0.26, ease: easeOut }} className="relative overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          {category && <GuidePanel key={category.label} ref={panelRef} category={category} panelId={panelId} skills={skills} disabled={disabled} selectedToolId={selectedToolId} onChoose={onChoose} onClose={() => setSelected(null)} reduce={reduce} />}
        </AnimatePresence>
      </motion.div>
      </LayoutGroup>
    </Tooltip.Provider>
  );
}
