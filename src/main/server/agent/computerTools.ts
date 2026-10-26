import { tool } from 'ai';
import type { PermissionMode } from '../../../shared/settings';
import type { ChatStreamEvent } from '../../../shared/stream';
import {
  COMPUTER_TOOL_NAME,
  ComputerInputSchema,
  summarizeComputerAction,
  type ComputerInput,
} from '../../../shared/computerUse';
import { createComputerController, isComputerUseSupported } from '../../computerUse';
import type { ComputerController } from '../../computerUse/types';
import { readScreenshot, saveScreenshot, screenshotContentOutput } from '../../computerUse/store';
import { ApprovalRequiredError, COMPUTER_CONFIRM_TOOL, requestPermission } from './permissions';
import { classifyConsequence, CONSEQUENCE_LABELS } from '../../../shared/computerConsequence';

export { isComputerUseSupported };

/** Shape persisted as the `computer` tool-call result string. */
export interface ComputerToolResult {
  ok: boolean;
  action: string;
  summary: string;
  cursor: { x: number; y: number } | null;
  screenSize: { width: number; height: number };
  /** Loopback API path the renderer loads the screenshot from. */
  screenshotUrl: string;
  /** `<session>/<file>` key under the computer-use dir, for history re-inflation. */
  screenshotFile: string;
  error?: string;
}

// One controller (one PowerShell/osascript pipe) per session, reused across the
// many actions of a turn. Torn down when the session's tools are rebuilt.
const controllers = new Map<string, ComputerController>();

export function disposeComputerController(sessionId: string): void {
  const existing = controllers.get(sessionId);
  if (existing) {
    existing.dispose();
    controllers.delete(sessionId);
  }
}

/** Keep at most this many idle input pipes alive across sessions. */
const MAX_LIVE_CONTROLLERS = 4;

function controllerFor(sessionId: string): ComputerController {
  let c = controllers.get(sessionId);
  if (!c) {
    while (controllers.size >= MAX_LIVE_CONTROLLERS) {
      const oldest = controllers.keys().next().value as string | undefined;
      if (!oldest) break;
      disposeComputerController(oldest);
    }
    c = createComputerController();
    controllers.set(sessionId, c);
  }
  return c;
}

export interface ComputerToolset {
  tools: ReturnType<typeof buildComputerTools>;
  executeApproved(args: Record<string, unknown>): Promise<{ result?: string; error?: string }>;
}

export function createComputerTools(options: {
  sessionId: string;
  dataRoot: string;
  permissionMode: PermissionMode;
  emit: (event: ChatStreamEvent) => void;
}): ComputerToolset {
  const { sessionId, dataRoot } = options;
  disposeComputerController(sessionId);

  async function perform(input: ComputerInput): Promise<ComputerToolResult> {
    const controller = controllerFor(sessionId);
    const summary = summarizeComputerAction(input);
    await controller.run(input);
    const shot = await controller.screenshot();
    const screenshotFile = await saveScreenshot(dataRoot, sessionId, shot.png);
    const cursorResult: { cursor: { x: number; y: number } | null } = await controller
      .run({ action: 'cursor_position' })
      .catch((): { cursor: null } => ({ cursor: null }));
    return {
      ok: true,
      action: input.action,
      summary,
      cursor: cursorResult.cursor,
      screenSize: shot.imageSize,
      screenshotUrl: `/api/computer-use/${screenshotFile}`,
      screenshotFile,
    };
  }

  return {
    tools: buildComputerTools({ ...options, perform }),
    async executeApproved(args) {
      try {
        // A confirmation card wraps the real action under `input`.
        const input = ComputerInputSchema.parse('input' in args && args.input && typeof args.input === 'object' ? args.input : args);
        return { result: JSON.stringify(await perform(input)) };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

function buildComputerTools(options: {
  sessionId: string;
  dataRoot: string;
  permissionMode: PermissionMode;
  perform: (input: ComputerInput) => Promise<ComputerToolResult>;
}) {
  const { sessionId, dataRoot, permissionMode, perform } = options;

  return {
    [COMPUTER_TOOL_NAME]: tool({
      description:
        'Control this computer: take a screenshot, then move / click / drag the mouse, scroll, type text, or press keys. ' +
        'Coordinates are pixels in the most recent screenshot you received (top-left origin). ' +
        'Always screenshot first, act on what you see, then screenshot again to check the result. ' +
        'The user is asked once per session before the first action. On every click / drag / type / key set `consequence` honestly: anything that sends, publishes, deletes, overwrites, installs, pays or changes credentials or security settings is declared with its category and a one-line `summary`, and the user must confirm it each time; use "none" for ordinary navigation.',
      inputSchema: ComputerInputSchema,
      execute: async (input, toolOptions): Promise<ComputerToolResult> => {
        // Something that sends, pays, deletes… is confirmed on its own, every time (never covered by a session grant).
        const consequence = classifyConsequence(input);
        const gate = consequence ? COMPUTER_CONFIRM_TOOL : COMPUTER_TOOL_NAME;
        const gateArgs = consequence
          ? { consequence, label: CONSEQUENCE_LABELS[consequence], summary: input.action === 'screenshot' ? '' : ('summary' in input ? input.summary ?? '' : ''), input }
          : (input as Record<string, unknown>);
        const ok = await requestPermission({
          sessionId,
          toolCallId: toolOptions.toolCallId,
          name: gate,
          args: gateArgs,
          mode: permissionMode,
        });
        if (!ok) {
          throw new ApprovalRequiredError({
            toolCallId: toolOptions.toolCallId,
            name: gate,
            args: gateArgs,
            kind: 'permission',
          });
        }
        return perform(input);
      },
      // Feed the follow-up screenshot back to the model as an actual image on
      // the live pass. The resume path re-inflates it from disk in
      // `assistantTurnToModelMessages`.
      toModelOutput: async ({ output }) => {
        const result = output as ComputerToolResult;
        const caption = `${result.summary}. cursor=${
          result.cursor ? `(${result.cursor.x},${result.cursor.y})` : 'unknown'
        } screen=${result.screenSize.width}x${result.screenSize.height}`;
        try {
          const png = await readScreenshot(dataRoot, result.screenshotFile);
          return screenshotContentOutput(caption, png);
        } catch {
          return { type: 'text', value: `${caption} (screenshot unavailable)` };
        }
      },
    }),
  };
}
