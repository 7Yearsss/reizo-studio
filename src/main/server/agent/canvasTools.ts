import { tool } from 'ai';
import { z } from 'zod';
import { CANVAS_IMAGE_SIZES, defaultNodeBox } from '../../../shared/canvas';
import { cameraFromPreset } from '../../../shared/cameraMotion';
import { serializeMention } from '../../../shared/resolveMentions';
import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasStore } from '../storage/canvasStore';
import { getCanvasChannel } from '../canvas/channel';
import { broadcastDownstreamDirty, runImageNode } from '../canvas/imageExecutor';
import { runAgentNode } from '../canvas/agentExecutor';
import { runVideoNode } from '../canvas/videoExecutor';
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
    // group containers: what they hold, so the agent can run / reason about one act
    memberIds: Array.isArray(params.memberIds) ? (params.memberIds as string[]) : undefined,
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
        'Add a node to this session\'s canvas. type "image" generates an image from `prompt`; type "agent" is a research/critique sub-task described by `instruction`; type "video" generates video from `prompt`; type "note" is a screenplay/script sticky note. In an image/video `prompt` you may embed inline references to other canvas nodes as `@[label](canvas:<nodeId>)` — at run time each becomes an ordered reference image (`<<<image 1>>>`, ...) drawn from that node\'s latest output, so you can say e.g. "把 @[主角定妆](canvas:abc123) 放进 @[雨夜街道](canvas:def456)". Returns the new node id. The canvas panel opens automatically.',
      inputSchema: z.object({
        type: z.enum(['image', 'agent', 'video', 'note']),
        prompt: z.string().optional().describe('Prompt (type "image", "video", or "note").'),
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
            : input.type === 'video'
              ? { prompt: input.prompt ?? '', duration: '5s', ratio: '16:9', cameraMotion: 'none' }
              : input.type === 'note'
                ? { content: input.instruction ?? input.prompt ?? '', color: 'amber' }
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

    create_storyboard_pipeline: tool({
      description:
        'Autonomous Director: generate a complete multi-scene cinematic storyboard pipeline on the canvas from a narrative request. Automatically creates an overview script note, sequential keyframe image nodes, camera-motion video nodes, and establishes links between them in a clean horizontal timeline layout.',
      inputSchema: z.object({
        storyTitle: z.string().describe('Title of the storyboard or film concept'),
        ratio: z.enum(['16:9', '9:16', '1:1']).default('16:9').describe('Aspect ratio for the scenes'),
        scenes: z
          .array(
            z.object({
              title: z.string().describe('Scene title e.g. "第 1 幕：雨夜追踪"'),
              script: z.string().describe('Script lines or scene narrative description'),
              imagePrompt: z.string().describe('Visual prompt for the keyframe image'),
              videoPrompt: z.string().describe('Dynamic camera motion and motion description for video'),
              camera: z
                .enum(['none', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'orbit'])
                .default('none')
                .describe('Camera motion technique'),
              duration: z.enum(['5s', '10s']).default('5s'),
            }),
          )
          .min(1)
          .max(8)
          .describe('List of scenes in chronological order'),
        autoRunFirstScene: z.boolean().default(false).describe('Whether to immediately trigger generation of the first scene'),
        carryReference: z
          .boolean()
          .default(true)
          .describe(
            'When true, every scene after the first gets an inline @[镜头1关键帧](canvas:<id>) reference appended to its image and video prompts so the character / style stays consistent across shots.',
          ),
      }),
      execute: async (input) => {
        const canvas = canvasStore.ensureCanvas(sessionId);
        const channel = getCanvasChannel(canvas.id);

        // 1. Create Overview Note card
        const scriptOverview = `# ${input.storyTitle}\n\n画幅比例: ${input.ratio}\n分镜总数: ${input.scenes.length}\n\n${input.scenes
          .map((s, idx) => `### 分镜 ${idx + 1}: ${s.title}\n${s.script}`)
          .join('\n\n')}`;

        const { rev: rNote, node: noteNode } = canvasStore.addNode(canvas.id, {
          type: 'note',
          x: 40,
          y: 60,
          w: 300,
          h: 420,
          title: `${input.storyTitle} (剧本大纲)`,
          params: { content: scriptOverview, color: 'amber' },
        });
        channel.broadcast(rNote, { type: 'node_added', node: noteNode });

        const createdSceneNodeIds: string[] = [];
        const imageNodes: CanvasNode[] = [];
        const videoNodes: CanvasNode[] = [];

        // 2. Create sequential scenes
        for (let i = 0; i < input.scenes.length; i++) {
          const sc = input.scenes[i];
          const colX = 380 + i * 360;

          // Character / style continuity: point later shots back at shot 1's keyframe.
          const continuity =
            input.carryReference && i > 0 && imageNodes[0]
              ? ` 保持 ${serializeMention('镜头1关键帧', imageNodes[0].id)} 中主体的外形、服装与风格一致。`
              : '';

          // Image Node (Keyframe)
          const imgBox = defaultNodeBox('image');
          const { rev: rImg, node: imgNode } = canvasStore.addNode(canvas.id, {
            type: 'image',
            x: colX,
            y: 60,
            w: imgBox.w,
            h: imgBox.h,
            title: `镜头 ${i + 1} · 关键帧`,
            params: {
              prompt: sc.imagePrompt + continuity,
              size: input.ratio === '9:16' ? '1024x1536' : '1536x1024',
              model: 'flux-schnell',
            },
          });
          channel.broadcast(rImg, { type: 'node_added', node: imgNode });
          imageNodes.push(imgNode);
          createdSceneNodeIds.push(imgNode.id);

          // Video Node (Motion)
          const vidBox = defaultNodeBox('video');
          const { rev: rVid, node: vidNode } = canvasStore.addNode(canvas.id, {
            type: 'video',
            x: colX,
            y: 480,
            w: vidBox.w,
            h: vidBox.h,
            title: `镜头 ${i + 1} · 运镜`,
            params: {
              prompt: sc.videoPrompt + continuity,
              duration: sc.duration,
              ratio: input.ratio,
              cameraMotion: sc.camera,
              camera: cameraFromPreset(sc.camera),
              model: 'kling-1.5',
            },
          });
          channel.broadcast(rVid, { type: 'node_added', node: vidNode });
          videoNodes.push(vidNode);
          createdSceneNodeIds.push(vidNode.id);

          // Edge: Image -> Video (start_frame)
          const { rev: rEdge, edge } = canvasStore.addEdge(canvas.id, {
            sourceId: imgNode.id,
            targetId: vidNode.id,
            targetHandle: 'start_frame',
          });
          channel.broadcast(rEdge, { type: 'edge_added', edge });

          // If note is next to scene 1, connect note to image 1
          if (i === 0) {
            const { rev: rNoteEdge, edge: noteEdge } = canvasStore.addEdge(canvas.id, {
              sourceId: noteNode.id,
              targetId: imgNode.id,
            });
            channel.broadcast(rNoteEdge, { type: 'edge_added', edge: noteEdge });
          } else {
            // Connect previous video to current image for visual continuity
            const prevVid = videoNodes[i - 1];
            const { rev: rSeqEdge, edge: seqEdge } = canvasStore.addEdge(canvas.id, {
              sourceId: prevVid.id,
              targetId: imgNode.id,
            });
            channel.broadcast(rSeqEdge, { type: 'edge_added', edge: seqEdge });
          }
        }

        if (input.autoRunFirstScene && imageNodes.length > 0) {
          void runImageNode({ canvasStore, settingsStore, dataRoot, canvasId: canvas.id, node: imageNodes[0] });
        }

        return {
          ok: true,
          storyTitle: input.storyTitle,
          totalScenes: input.scenes.length,
          noteId: noteNode.id,
          createdNodeIds: createdSceneNodeIds,
          summary: `已在画布上生成全套分镜编排流水线（包含 1 个剧本大纲卡、${input.scenes.length} 个关键帧图片卡、${input.scenes.length} 个运镜视频卡，并已完成全流水线自动连线）。`,
        };
      },
    }),

    run_node: tool({
      description:
        'Run a canvas node by id. An image or video node generates the media; an agent node runs a read-only research/critique pass. Returns immediately; the result streams onto the canvas.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const canvas = canvasStore.ensureCanvas(sessionId);
        const node = canvasStore.getNode(canvas.id, id);
        if (!node) return { error: `No canvas node "${id}"` };
        if (node.type === 'agent') {
          void runAgentNode({ canvasStore, settingsStore, dataRoot, canvasId: canvas.id, node });
        } else if (node.type === 'video') {
          void runVideoNode({ canvasStore, settingsStore, dataRoot, canvasId: canvas.id, node });
        } else {
          void runImageNode({ canvasStore, settingsStore, dataRoot, canvasId: canvas.id, node });
        }
        return { ok: true, id, status: 'running' };
      },
    }),

    run_graph: tool({
      description:
        'Run the canvas as a pipeline. Independent nodes in the same dependency layer run in parallel; a node starts only after its inputs are done. Pass `from` to run that node and everything downstream, or `nodeIds` to run only an explicit set (e.g. the members of one group). `from` and `nodeIds` are mutually exclusive — `nodeIds` wins. Returns immediately; results stream onto the canvas.',
      inputSchema: z.object({
        from: z.string().optional(),
        nodeIds: z
          .array(z.string())
          .optional()
          .describe("Explicit whitelist of node ids to run. Pass a group node's memberIds to run just that group."),
      }),
      execute: async ({ from, nodeIds }) => {
        const canvas = canvasStore.ensureCanvas(sessionId);
        if (from && !canvasStore.getNode(canvas.id, from)) return { error: `No canvas node "${from}"` };
        const missing = (nodeIds ?? []).filter((id) => !canvasStore.getNode(canvas.id, id));
        if (missing.length > 0) return { error: `No canvas node(s) ${missing.join(', ')}` };
        void runGraph({
          canvasStore,
          settingsStore,
          dataRoot,
          canvasId: canvas.id,
          fromNodeId: from,
          nodeIds,
        });
        return { ok: true, status: 'running', scope: nodeIds ? 'nodeIds' : from ? 'from' : 'all' };
      },
    }),

    group_nodes: tool({
      description:
        'Wrap existing canvas nodes in a group container: a labelled, coloured box that can be dragged as a unit, locked, focused, and run on its own. Use it to keep one storyboard act / scene set tidy after building a multi-shot pipeline. Returns the new group node id.',
      inputSchema: z.object({
        nodeIds: z.array(z.string()).min(1).describe('Ids of the nodes to put in the group.'),
        title: z.string().optional().describe('Group label, e.g. "第 1 幕：雨夜追踪".'),
        color: z.string().optional().describe('Hex colour for the container, e.g. "#3b82f6".'),
      }),
      execute: async ({ nodeIds, title, color }) => {
        const canvas = canvasStore.ensureCanvas(sessionId);
        const members = nodeIds
          .map((id) => canvasStore.getNode(canvas.id, id))
          .filter((n): n is CanvasNode => Boolean(n) && n!.type !== 'group');
        if (members.length === 0) return { error: 'None of those node ids exist on the canvas' };

        const padding = 28;
        const header = 42;
        const minX = Math.min(...members.map((n) => n.x));
        const minY = Math.min(...members.map((n) => n.y));
        const maxX = Math.max(...members.map((n) => n.x + n.w));
        const maxY = Math.max(...members.map((n) => n.y + n.h));

        const { rev, node } = canvasStore.addNode(canvas.id, {
          type: 'group',
          x: Math.round(minX - padding),
          y: Math.round(minY - header),
          w: Math.round(maxX - minX + padding * 2),
          h: Math.round(maxY - minY + header + padding),
          title: title ?? '分镜组',
          params: { memberIds: members.map((n) => n.id), color: color ?? '#3b82f6', locked: false },
        });
        getCanvasChannel(canvas.id).broadcast(rev, { type: 'node_added', node });
        return { id: node.id, memberIds: members.map((n) => n.id) };
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
      description: 'Change a canvas node\'s params. For an image node pass `prompt` and/or `size`; for an agent node pass `instruction`; for a video node pass `prompt` and/or `camera` (structured camera motion, each axis −10..10). Also renames via `title`. An image/video `prompt` may embed `@[label](canvas:<nodeId>)` references to other nodes — each resolves to an ordered reference image from that node\'s output at run time. Does not re-run the node.',
      inputSchema: z.object({
        id: z.string(),
        prompt: z.string().optional(),
        size: z.enum(CANVAS_IMAGE_SIZES as [string, ...string[]]).optional(),
        instruction: z.string().optional(),
        title: z.string().optional(),
        camera: z
          .object({
            horizontal: z.number().min(-10).max(10).optional(),
            vertical: z.number().min(-10).max(10).optional(),
            pan: z.number().min(-10).max(10).optional(),
            tilt: z.number().min(-10).max(10).optional(),
            roll: z.number().min(-10).max(10).optional(),
            zoom: z.number().min(-10).max(10).optional(),
          })
          .optional()
          .describe('Video node only. Camera motion by axis; negative = left/down/out/ccw, positive = right/up/in/cw.'),
      }),
      execute: async ({ id, prompt, size, instruction, title, camera }) => {
        const canvas = canvasStore.ensureCanvas(sessionId);
        const node = canvasStore.getNode(canvas.id, id);
        if (!node) return { error: `No canvas node "${id}"` };
        const params = { ...(node.params as Record<string, unknown>) };
        if (prompt !== undefined) params.prompt = prompt;
        if (size !== undefined) params.size = size;
        if (instruction !== undefined) params.instruction = instruction;
        if (camera !== undefined) params.camera = camera;
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
