import { tool } from 'ai';
import { z } from 'zod';
import { CANVAS_IMAGE_SIZES, defaultNodeBox } from '../../../shared/canvas';
import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasStore } from '../storage/canvasStore';
import { getCanvasChannel } from '../canvas/channel';
import { runImageNode } from '../canvas/imageExecutor';
import { runGraph } from '../canvas/graphExecutor';

/**
 * Agent-facing canvas tools (slice C: `add_node`, `run_node`). Structure edits
 * are not gated (decision 10 — same as `todo_write`). `run_node` on an image
 * node is a paid call but agent-initiated inside a user-started turn, so it
 * runs directly here; the UI Run button is the pre-flight-confirmed path.
 */
export function createCanvasTools(options: {
  sessionId: string;
  canvasStore: CanvasStore;
  settingsStore: SettingsStore;
  dataRoot: string;
}) {
  const { sessionId, canvasStore, settingsStore, dataRoot } = options;

  return {
    add_node: tool({
      description:
        'Add a node to this session\'s canvas. type "image" generates an image from `prompt`; type "agent" is a research/critique sub-task described by `instruction`. Returns the new node id. The canvas panel opens automatically.',
      inputSchema: z.object({
        type: z.enum(['image', 'agent']),
        prompt: z.string().optional().describe('Image prompt (type "image").'),
        size: z.enum(CANVAS_IMAGE_SIZES as [string, ...string[]]).optional(),
        instruction: z.string().optional().describe('Task description (type "agent").'),
        title: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
      execute: async (input) => {
        const canvas = canvasStore.ensureCanvas(sessionId);
        const box = defaultNodeBox(input.type);
        const params =
          input.type === 'image'
            ? { prompt: input.prompt ?? '', size: input.size ?? '1024x1024' }
            : { instruction: input.instruction ?? '' };
        const { rev, node } = canvasStore.addNode(canvas.id, {
          type: input.type,
          x: typeof input.x === 'number' ? input.x : 40,
          y: typeof input.y === 'number' ? input.y : 40,
          w: box.w,
          h: box.h,
          title: input.title ?? '',
          params,
        });
        getCanvasChannel(canvas.id).broadcast(rev, { type: 'node_added', node });
        return { id: node.id, canvasId: canvas.id, type: node.type };
      },
    }),

    run_node: tool({
      description:
        'Run a canvas node by id. For an image node this generates the image (a paid call). Returns immediately; the result streams onto the canvas.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const canvas = canvasStore.ensureCanvas(sessionId);
        const node = canvasStore.getNode(canvas.id, id);
        if (!node) return { error: `No canvas node "${id}"` };
        if (node.type !== 'image') return { error: 'Only image nodes can be run in this version' };
        void runImageNode({ canvasStore, settingsStore, dataRoot, canvasId: canvas.id, node });
        return { ok: true, id, status: 'running' };
      },
    }),

    run_graph: tool({
      description:
        'Run the whole canvas as a pipeline (topological order; a node runs after its inputs). Pass `from` to run only that node and everything downstream. Returns immediately; results stream onto the canvas.',
      inputSchema: z.object({ from: z.string().optional() }),
      execute: async ({ from }) => {
        const canvas = canvasStore.ensureCanvas(sessionId);
        if (from && !canvasStore.getNode(canvas.id, from)) return { error: `No canvas node "${from}"` };
        void runGraph({ canvasStore, settingsStore, dataRoot, canvasId: canvas.id, fromNodeId: from });
        return { ok: true, status: 'running' };
      },
    }),
  };
}
