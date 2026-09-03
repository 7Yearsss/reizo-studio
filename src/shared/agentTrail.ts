/**
 * Derives a compact "the agent just did X on the canvas" record from a chat
 * tool-call event. This is the single parse point — the activity strip, the
 * `✦` node marks, the bounding-box `fitView`, and the undo batching all read
 * from `AgentTrailEntry`. Pure: no IO, no DOM.
 */

export type TrailVerb =
  | 'add'
  | 'connect'
  | 'update'
  | 'run'
  | 'group'
  | 'attach'
  | 'delete'
  | 'orchestrate';

export interface AgentTrailEntry {
  /** = toolCallId — naturally dedupes and is the batch id for undo. */
  id: string;
  tool: string;
  verb: TrailVerb;
  /** Human summary, zh, short (≈ ≤ 24 chars). e.g. "编排 13 个节点". */
  label: string;
  /** Nodes this call touched — drives spotlight / fitView / mark / undo. */
  nodeIds: string[];
  at: number;
  status: 'running' | 'done' | 'error';
}

export interface ToolEventLike {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
}

const CANVAS_TOOL_VERBS: Record<string, TrailVerb> = {
  add_node: 'add',
  create_storyboard_pipeline: 'orchestrate',
  connect_nodes: 'connect',
  attach_reference: 'attach',
  group_nodes: 'group',
  run_node: 'run',
  run_graph: 'run',
  update_node: 'update',
  delete_node: 'delete',
};

/**
 * Additive structural writes whose batch lands in the undo stack (P0-2).
 * `delete` is excluded on purpose: by the time the tool result arrives the
 * node + edges are already gone from renderer state, so there is nothing left
 * to snapshot for the rebuild.
 */
export const UNDOABLE_TRAIL_VERBS: ReadonlySet<TrailVerb> = new Set<TrailVerb>([
  'add',
  'connect',
  'group',
  'attach',
  'orchestrate',
]);

export function isCanvasTool(name: string): boolean {
  return name in CANVAS_TOOL_VERBS || name === 'read_canvas' || name === 'read_node';
}

function parseResult(result?: string): Record<string, unknown> | null {
  if (!result) return null;
  try {
    const v = JSON.parse(result) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function nodeIdsFor(name: string, args: Record<string, unknown>, res: Record<string, unknown> | null): string[] {
  switch (name) {
    case 'add_node': {
      const id = asStr(res?.id);
      return id ? [id] : [];
    }
    case 'create_storyboard_pipeline': {
      const ids = asStrArr(res?.createdNodeIds);
      const note = asStr(res?.noteId);
      return note ? [note, ...ids] : ids;
    }
    case 'connect_nodes':
      return [asStr(args.source), asStr(args.target)].filter((x): x is string => Boolean(x));
    case 'attach_reference': {
      const a = asStr(args.anchorId);
      return [...(a ? [a] : []), ...asStrArr(args.targetIds)];
    }
    case 'group_nodes': {
      const gid = asStr(res?.id);
      return [...(gid ? [gid] : []), ...asStrArr(res?.memberIds)];
    }
    case 'run_graph': {
      const ids = asStrArr(args.nodeIds);
      if (ids.length > 0) return ids;
      const from = asStr(args.from);
      return from ? [from] : [];
    }
    default: {
      // run_node / update_node / delete_node
      const id = asStr(args.id);
      return id ? [id] : [];
    }
  }
}

function labelFor(
  name: string,
  verb: TrailVerb,
  nodeIds: string[],
  args: Record<string, unknown>,
): string {
  switch (name) {
    case 'add_node':
      return `新增 ${asStr(args.type) ?? ''}节点`.trim();
    case 'create_storyboard_pipeline':
      return `编排 ${nodeIds.length} 个节点`;
    case 'connect_nodes':
      return '连接两个节点';
    case 'attach_reference':
      return `挂参考到 ${Math.max(0, nodeIds.length - 1)} 个节点`;
    case 'group_nodes':
      return `成组 ${Math.max(0, nodeIds.length - 1)} 个节点`;
    case 'run_node':
      return '运行一个节点';
    case 'run_graph':
      return nodeIds.length > 0 ? `运行 ${nodeIds.length} 个节点` : '运行整图';
    case 'update_node':
      return '修改一个节点';
    case 'delete_node':
      return '删除一个节点';
    default:
      return verb;
  }
}

/** Read-only tools (`read_canvas` / `read_node`) return null — reads leave no trail. */
export function trailEntryFromTool(part: ToolEventLike): AgentTrailEntry | null {
  const verb = CANVAS_TOOL_VERBS[part.name];
  if (!verb) return null;

  const args = part.args ?? {};
  const res = parseResult(part.result);
  const status: AgentTrailEntry['status'] = part.error
    ? 'error'
    : part.result !== undefined
      ? 'done'
      : 'running';
  const nodeIds = nodeIdsFor(part.name, args, res);

  return {
    id: part.id,
    tool: part.name,
    verb,
    label: labelFor(part.name, verb, nodeIds, args),
    nodeIds,
    at: Date.now(),
    status,
  };
}
