import { SHORTCUTS } from './shortcutRegistry';

/** Registry ids whose key the user may change. Their listeners read the resolved binding. */
export const REBINDABLE_IDS = ['palette', 'sidebar', 'shortcuts'] as const;
export type RebindableId = (typeof REBINDABLE_IDS)[number];

export type ShortcutOverrides = Partial<Record<RebindableId, string>>;

export interface KeyEventLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Keys the OS, browser or text editing already owns; binding them would break the app. */
const RESERVED = new Set([
  'Mod+C', 'Mod+V', 'Mod+X', 'Mod+Z', 'Mod+A', 'Mod+Y', 'Mod+W', 'Mod+Q', 'Mod+R', 'Mod+N', 'Mod+P', 'Mod+S',
  'Alt+F4', 'Escape', 'Enter', 'Tab',
]);

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift']);

function normalizeKey(key: string, code?: string): string {
  if (key === ' ') return 'Space';
  if (code === 'Slash') return '/';
  return key.length === 1 ? key.toUpperCase() : key;
}

/** `Mod+Shift+K` from a keydown, or null while only a modifier is held. Mod = Ctrl or ⌘ (either counts). */
export function eventToKeys(e: KeyEventLike): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(normalizeKey(e.key, e.code));
  return parts.join('+');
}

export function matchesKeys(keys: string, e: KeyEventLike): boolean {
  return eventToKeys(e) === keys;
}

export function resolveKeys(id: RebindableId, overrides: ShortcutOverrides): string {
  const own = overrides[id];
  if (own) return own;
  const entry = SHORTCUTS.find((s) => s.id === id);
  if (!entry) throw new Error(`unknown shortcut ${id}`);
  return entry.keys;
}

export type BindingCheck = { ok: true } | { ok: false; reason: string };

/** Reject bindings the app cannot honour: bare keys, reserved keys, or ones another shortcut already uses. */
export function validateBinding(id: RebindableId, keys: string, overrides: ShortcutOverrides): BindingCheck {
  const parts = keys.split('+');
  const hasModifier = parts.length > 1 && parts.slice(0, -1).every((p) => ['Mod', 'Alt', 'Shift'].includes(p));
  if (!hasModifier) return { ok: false, reason: '需要至少一个修饰键（Ctrl/⌘、Alt）' };
  if (!parts.some((p) => p === 'Mod' || p === 'Alt')) return { ok: false, reason: '仅 Shift 会与输入冲突，请加上 Ctrl/⌘ 或 Alt' };
  if (RESERVED.has(keys)) return { ok: false, reason: '这个组合被系统或文本编辑占用' };
  for (const entry of SHORTCUTS) {
    if (entry.id === id) continue;
    const current = (REBINDABLE_IDS as readonly string[]).includes(entry.id)
      ? resolveKeys(entry.id as RebindableId, overrides)
      : entry.keys;
    if (current === keys) return { ok: false, reason: `已被「${entry.label}」使用` };
  }
  return { ok: true };
}

/** Overrides are stored as the user left them; anything unknown or equal to the default is dropped on load. */
export function sanitizeOverrides(raw: unknown): ShortcutOverrides {
  if (!raw || typeof raw !== 'object') return {};
  const out: ShortcutOverrides = {};
  for (const id of REBINDABLE_IDS) {
    const v = (raw as Record<string, unknown>)[id];
    if (typeof v !== 'string') continue;
    const def = SHORTCUTS.find((s) => s.id === id)?.keys;
    if (v === def) continue;
    if (validateBinding(id, v, out).ok) out[id] = v;
  }
  return out;
}
