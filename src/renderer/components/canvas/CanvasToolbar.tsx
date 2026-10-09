import type { ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import type { LucideIcon } from 'lucide-react';
import { Button } from '../ui/button';
import Tooltip from '../ui/Tooltip';
import { CANVAS_MENU_SURFACE, CanvasCommandGroup, CanvasCommandItem } from './CanvasCommandMenu';

export function CanvasToolButton({ children, onClick, title, active, disabled, primary, side = 'top' }: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
  primary?: boolean;
  side?: 'top' | 'right';
}) {
  return (
    <Tooltip content={title} side={side}>
      <Button type="button" variant={primary ? 'default' : active ? 'secondary' : 'ghost'} size="icon-sm" aria-label={title} aria-pressed={active} disabled={disabled} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}

export interface CanvasToolbarItem { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; }

export function CanvasToolbarDropdown({ open, onToggle, icon: Icon, label, items, primary }: {
  open: boolean;
  onToggle: () => void;
  icon: LucideIcon;
  label: string;
  items: CanvasToolbarItem[];
  primary?: boolean;
}) {
  return (
    <DropdownMenu.Root open={open} modal={false} onOpenChange={(next) => { if (next !== open) onToggle(); }}>
      <Tooltip content={label} side="right">
        <DropdownMenu.Trigger asChild>
          <Button type="button" variant={primary ? 'default' : open ? 'secondary' : 'ghost'} size="icon-sm" aria-label={label}>
            <Icon />
          </Button>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content data-canvas-command-menu aria-label={label} side="right" align="start" sideOffset={12} collisionPadding={12} loop className={CANVAS_MENU_SURFACE} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <CanvasCommandGroup>
            {items.map((item) => <CanvasCommandItem key={item.label} icon={item.icon} label={item.label} onAction={item.onClick} disabled={item.disabled} />)}
          </CanvasCommandGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
