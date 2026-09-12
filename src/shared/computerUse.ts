import { z } from 'zod';

/**
 * Computer-use vocabulary and the `computer` tool's input schema.
 *
 * Shared by all three surfaces. The action set is a trimmed version of cua's
 * `BaseComputerInterface` (see docs/computer-use-integration.md) — enough for
 * a real screenshot→act→screenshot loop, without window/clipboard/fs extras
 * the agent already has other tools for.
 */

/** The single agent-facing tool name. */
export const COMPUTER_TOOL_NAME = 'computer';

/**
 * How many of the most recent `computer` screenshots are re-sent to the model
 * as images when history is rebuilt. Older ones collapse to a text line so the
 * context window doesn't grow without bound.
 */
export const SCREENSHOT_RETENTION = 2;

/** Screenshots are downscaled so their longest edge is at most this many px. */
export const MAX_SCREENSHOT_EDGE = 1440;

/** Settle delay applied after every action before the follow-up screenshot. */
export const ACTION_SETTLE_MS = 350;

export const COMPUTER_ACTIONS = [
  'screenshot',
  'cursor_position',
  'move',
  'left_click',
  'right_click',
  'middle_click',
  'double_click',
  'left_click_drag',
  'left_mouse_down',
  'left_mouse_up',
  'scroll',
  'type',
  'key',
  'wait',
] as const;

export type ComputerActionName = (typeof COMPUTER_ACTIONS)[number];

const point = {
  x: z.number().int().describe('X pixel, from the left edge of the primary display.'),
  y: z.number().int().describe('Y pixel, from the top edge of the primary display.'),
};
const optionalPoint = {
  x: z.number().int().optional().describe('X pixel. Defaults to the current cursor X.'),
  y: z.number().int().optional().describe('Y pixel. Defaults to the current cursor Y.'),
};

/**
 * Discriminated union on `action`. Kept flat (no nested `coordinate` tuple) so
 * OpenAI-compatible function-calling models fill it reliably.
 */
export const ComputerInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('screenshot') }).describe('Capture the screen. Take one before acting.'),
  z.object({ action: z.literal('cursor_position') }).describe('Report the current cursor x/y.'),
  z.object({ action: z.literal('move'), ...point }).describe('Move the cursor without clicking.'),
  z.object({ action: z.literal('left_click'), ...optionalPoint }).describe('Left click.'),
  z.object({ action: z.literal('right_click'), ...optionalPoint }).describe('Right click.'),
  z.object({ action: z.literal('middle_click'), ...optionalPoint }).describe('Middle click.'),
  z.object({ action: z.literal('double_click'), ...optionalPoint }).describe('Double left click.'),
  z
    .object({
      action: z.literal('left_click_drag'),
      ...point,
      fromX: z.number().int().optional().describe('Drag start X. Defaults to the current cursor X.'),
      fromY: z.number().int().optional().describe('Drag start Y. Defaults to the current cursor Y.'),
    })
    .describe('Press the left button at (fromX,fromY), move to (x,y), release.'),
  z.object({ action: z.literal('left_mouse_down'), ...optionalPoint }).describe('Press and hold the left button.'),
  z.object({ action: z.literal('left_mouse_up'), ...optionalPoint }).describe('Release the left button.'),
  z
    .object({
      action: z.literal('scroll'),
      ...optionalPoint,
      direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction.'),
      amount: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe('Wheel clicks / notches. Defaults to 3.'),
    })
    .describe('Scroll the surface under the cursor.'),
  z
    .object({ action: z.literal('type'), text: z.string().min(1).describe('Literal UTF-8 text to type.') })
    .describe('Type text at the current focus.'),
  z
    .object({
      action: z.literal('key'),
      keys: z
        .string()
        .min(1)
        .describe('A key or chord, xdotool style: "Return", "ctrl+s", "alt+Tab", "cmd+shift+4".'),
    })
    .describe('Press a key or key combination.'),
  z
    .object({
      action: z.literal('wait'),
      ms: z.number().int().min(1).max(10_000).optional().describe('Milliseconds to wait. Defaults to 800.'),
    })
    .describe('Wait for the UI to settle.'),
]);

export type ComputerInput = z.infer<typeof ComputerInputSchema>;

export interface ScreenSize {
  width: number;
  height: number;
}

export interface CursorPoint {
  x: number;
  y: number;
}

/** Clamp a point into `[0, width-1] × [0, height-1]`. */
export function clampPoint(p: CursorPoint, size: ScreenSize): CursorPoint {
  const clamp = (v: number, max: number) => (Number.isFinite(v) ? Math.min(Math.max(Math.round(v), 0), Math.max(max - 1, 0)) : 0);
  return { x: clamp(p.x, size.width), y: clamp(p.y, size.height) };
}

/**
 * Normalize a chord to a lowercase `+`-joined form with canonical modifier
 * names (`ctrl`, `alt`, `shift`, `meta`). The final non-modifier token keeps
 * its original casing so `Return` / `Tab` / `F5` survive.
 */
export function normalizeHotkey(keys: string): string {
  const parts = keys
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';
  const modAlias: Record<string, string> = {
    control: 'ctrl',
    ctrl: 'ctrl',
    ctl: 'ctrl',
    alt: 'alt',
    option: 'alt',
    opt: 'alt',
    shift: 'shift',
    cmd: 'meta',
    command: 'meta',
    super: 'meta',
    win: 'meta',
    windows: 'meta',
    meta: 'meta',
  };
  const order = ['ctrl', 'alt', 'shift', 'meta'];
  const mods = new Set<string>();
  const rest: string[] = [];
  for (const part of parts) {
    const alias = modAlias[part.toLowerCase()];
    if (alias) mods.add(alias);
    else rest.push(part);
  }
  const sortedMods = order.filter((m) => mods.has(m));
  return [...sortedMods, ...rest].join('+');
}

/** One-line, human-readable description of an action for tool cards / logs. */
export function summarizeComputerAction(input: ComputerInput): string {
  switch (input.action) {
    case 'screenshot':
      return '截屏';
    case 'cursor_position':
      return '读取光标位置';
    case 'move':
      return `移动光标到 (${input.x}, ${input.y})`;
    case 'left_click':
      return `左键点击${pointSuffix(input)}`;
    case 'right_click':
      return `右键点击${pointSuffix(input)}`;
    case 'middle_click':
      return `中键点击${pointSuffix(input)}`;
    case 'double_click':
      return `双击${pointSuffix(input)}`;
    case 'left_click_drag':
      return `拖拽到 (${input.x}, ${input.y})`;
    case 'left_mouse_down':
      return `按下左键${pointSuffix(input)}`;
    case 'left_mouse_up':
      return `松开左键${pointSuffix(input)}`;
    case 'scroll':
      return `滚动 ${input.direction} ×${input.amount ?? 3}`;
    case 'type':
      return `输入文本 “${input.text.length > 40 ? `${input.text.slice(0, 40)}…` : input.text}”`;
    case 'key':
      return `按键 ${normalizeHotkey(input.keys) || input.keys}`;
    case 'wait':
      return `等待 ${input.ms ?? 800}ms`;
    default:
      return (input as { action: string }).action;
  }
}

function pointSuffix(input: { x?: number; y?: number }): string {
  return typeof input.x === 'number' && typeof input.y === 'number' ? ` (${input.x}, ${input.y})` : '（当前位置）';
}
