import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DropdownMenu } from 'radix-ui';
import { ArrowLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

export const CANVAS_MENU_SURFACE = 'z-50 min-w-56 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-xl border border-border bg-card p-1.5 text-foreground shadow-xl outline-none';

/** A point-anchored command surface. Radix owns collision, dismissal and keyboard navigation. */
export function CanvasCommandMenu({
  x, y, label, onClose, onBack, pageKey, children, className,
}: {
  x: number;
  y: number;
  label: string;
  onClose: () => void;
  onBack?: () => void;
  pageKey?: string;
  children: ReactNode;
  className?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const shouldReturnFocus = useRef(true);
  const setContentRef = useCallback((element: HTMLDivElement | null) => {
    contentRef.current = element;
    if (element) requestAnimationFrame(() => { if (element.isConnected) element.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus(); });
  }, []);

  // Replacing a submenu keeps its spatial anchor and starts keyboard navigation
  // at its first action rather than leaving focus on a removed parent item.
  useLayoutEffect(() => {
    contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus();
  }, [pageKey]);

  return (
    <DropdownMenu.Root open modal={false} onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* Portaled to body: inside the drawer a transformed ancestor would turn `fixed` into
          drawer-relative and push the menu away from the click point. */}
      {createPortal(
        <DropdownMenu.Trigger asChild>
          <button type="button" tabIndex={-1} aria-hidden className="pointer-events-none fixed size-px opacity-0" style={{ left: x, top: y }} />
        </DropdownMenu.Trigger>,
        document.body,
      )}
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          ref={setContentRef}
          data-canvas-command-menu
          aria-label={label}
          side="bottom"
          align="start"
          sideOffset={0}
          collisionPadding={12}
          loop
          className={cn(CANVAS_MENU_SURFACE, className)}
          onEscapeKeyDown={(event) => { if (onBack) { event.preventDefault(); onBack(); } }}
          onInteractOutside={() => { shouldReturnFocus.current = false; }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (shouldReturnFocus.current && returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
          }}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'ArrowLeft' && onBack) { event.preventDefault(); onBack(); }
          }}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
        >
          {onBack ? <DropdownMenu.Group><CanvasCommandItem icon={ArrowLeft} label="返回" keepOpen onAction={onBack} /><CanvasCommandSeparator /></DropdownMenu.Group> : null}
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export const CanvasCommandGroup = DropdownMenu.Group;

export function CanvasCommandLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-2.5 pb-1.5 pt-2 text-[11px] font-medium text-muted-foreground">{children}</DropdownMenu.Label>;
}

export function CanvasCommandSeparator() {
  return <DropdownMenu.Separator className="my-1.5 h-px bg-border" />;
}

export function CanvasCommandItem({
  icon: Icon, label, description, shortcut, onAction, disabled, danger, keepOpen, submenu,
}: {
  icon?: LucideIcon;
  label: string;
  description?: string;
  shortcut?: string;
  onAction: () => void;
  disabled?: boolean;
  danger?: boolean;
  keepOpen?: boolean;
  submenu?: boolean;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      title={disabled ? description : undefined}
      textValue={label}
      onSelect={(event) => { if (keepOpen) event.preventDefault(); onAction(); }}
      onKeyDown={(event) => { if (submenu && event.key === 'ArrowRight') { event.preventDefault(); onAction(); } }}
      className={cn(
        'flex min-h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs outline-none transition-colors data-[highlighted]:bg-muted data-[highlighted]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-35',
        danger && 'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive',
      )}
    >
      {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span>{label}</span>{description ? <span className="text-[11px] leading-4 text-muted-foreground">{description}</span> : null}</span>
      {shortcut ? <span aria-hidden className="ml-3 shrink-0 text-[10px] text-muted-foreground">{shortcut}</span> : null}
      {submenu ? <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
    </DropdownMenu.Item>
  );
}
