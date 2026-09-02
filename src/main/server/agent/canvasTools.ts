import { tool } from 'ai';
import { z } from 'zod';
import { CANVAS_IMAGE_SIZES, defaultNodeBox } from '../../../shared/canvas';
import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasStore } from '../storage/canvasStore';
import { getCanvasChannel } from '../canvas/channel';
import { broadcastDownstreamDirty, runImageNode } from '../canvas/imageExecutor';
import { runGraph } from '../canvas/graphExecutor';
import type { CanvasNode } from '../../../shared/canvas';

function nodeBrief(node: CanvasNode) {
  const params = node.params as Record<string, unknown>;
  return {
    id: node.id,
    type: node.type,
    title: node.title || null,
    runState: node.runState,
    dirty: node.dirty ?? false,
    prompt: typeof params.prompt === 'string' ? params.prompt : undefined,
    instruction: typeof params.instruction === 'string' ? params.instruction : undefined,
    size: typeof params.size === 'string' ? params.size : undefined,
    assets: node.output?.assets ?? [],
    error: node.output?.error,
  };
}

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

    read_canvas: tool({
      description: 'List every node on this session\'s canvas with its type, run state, prompt/instruction and outputs, plus the edges between them.',
      inputSchema: z.object({}),
      execute: async () => {
        const canvas = canvasStore.findCanvasBySession(sessionId);
        if (!canvas) return { nodes: [], edges: [] };
        const snap = canvasStore.getSnapshot(canvas.id);
        return {
          nodes: (snap?.nodes ?? []).map(nodeBrief),
          edges: (snap?.edges ?? []).map((e) => ({ source: e.sourceId, target: e.targetId })),
        };
      },
    }),

    read_node: tool({
      description: 'Read one canvas node in full (params, run state, output assets/error).',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const canvas = canvasStore.findCanvasBySession(sessionId);
        const node = canvas ? canvasStore.getNode(canvas.id, id) : null;
        return node ? nodeBrief(node) : { error: `No canvas node "${id}"` };
      },
    }),

    update_node: tool({
      description: 'Change a canvas node\'s params. For an image node pass `prompt` and/or `size`; for an agent node pass `instruction`. Also renames via `title`. Does not re-run the node.',
      inputSchema: z.object({
        id: z.string(),
        prompt: z.string().optional(),
        size: z.enum(CANVAS_IMAGE_SIZES as [string, ...string[]]).optional(),
        instruction: z.string().optional(),
        title: z.string().optional(),
      }),
      execute: async ({ id, prompt, size, instruction, title }) => {
        const canvas = canvasStore.ensureCanvas(sessionId);
        const node = canvasStore.getNode(canvas.id, id);
        if (!node) return { error: `No canvas node "${id}"` };
        const params = { ...(node.params as Record<string, unknown>) };
        if (prompt !== undefined) params.prompt = prompt;
        if (size !== undefined) params.size = size;
        if (instruction !== undefined) params.instruction = instruction;
        const res = canvasStore.updateNode(canvas.id, id, {
          params,
          ...(title !== undefined ? { title } : {}),
        });
        if (!res) return { error: `No canvas node "${id}"` };
        const channel = getCanvasChannel(canvas.id);
        channel.broadcast(res.rev, { type: 'node_updated', node: res.node });
        broadcastDownstreamDirty(canvasStore, canvas.id, id, res.rev);
        return { id, params: res.node.params };
      },
    }),

    connect_nodes: tool({
      description: 'Wire one canvas node\'s output into another node\'s input (source -> target). An image node with an image input does image-to-image.',
      inputSchema: z.object({ source: z.string(), target: z.string() }),
      execute: async ({ source, target }) => {
        const canvas = canvasStore.ensureCanvas(sessionId);
        const res = canvasStore.addEdge(canvas.id, { sourceId: source, targetId: target });
        if (res.error === 'cycle') return { error: 'That connection would create a cycle' };
        if (res.error || !res.edge || res.rev === undefined) return { error: 'source or target node not found' };
        const channel = getCanvasChannel(canvas.id);
        channel.broadcast(res.rev, { type: 'edge_added', edge: res.edge });
        broadcastDownstreamDirty(canvasStore, canvas.id, source, res.rev);
        return { edgeId: res.edge.id };
      },
    }),

    delete_node: tool({
      description: 'Remove a canvas node and any edges touching it.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const canvas = canvasStore.ensureCanvas(sessionId);
        const res = canvasStore.deleteNode(canvas.id, id);
        if (!res) return { error: `No canvas node "${id}"` };
        getCanvasChannel(canvas.id).broadcast(res.rev, { type: 'node_deleted', id });
        return { ok: true };
      },
    }),
  };
}
