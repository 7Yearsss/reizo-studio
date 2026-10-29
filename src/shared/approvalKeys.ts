export interface ApprovalKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  /** Tag name, role and editability of the focused element. */
  target?: { tag?: string; role?: string | null; editable?: boolean } | null;
}

export type ApprovalKeyAction = 'allow' | 'allow-session' | 'deny' | null;

const INTERACTIVE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']);
const INTERACTIVE_ROLES = new Set(['textbox', 'button', 'link', 'menuitem', 'option', 'combobox']);

function onInteractive(target: ApprovalKeyEvent['target']): boolean {
  if (!target) return false;
  return Boolean(target.editable) || INTERACTIVE_TAGS.has((target.tag ?? '').toUpperCase()) || INTERACTIVE_ROLES.has(target.role ?? '');
}

/**
 * What a key press does to a pending approval. Enter yields to anything focused that already handles Enter
 * (typing, IME composition, a button — Enter on "拒绝" must not approve); Esc still denies from anywhere
 * except while composing.
 */
export function approvalKeyAction(event: ApprovalKeyEvent): ApprovalKeyAction {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.key === 'Escape') return 'deny';
  if (event.key !== 'Enter') return null;
  if (onInteractive(event.target)) return null;
  return event.ctrlKey || event.metaKey ? 'allow-session' : 'allow';
}
