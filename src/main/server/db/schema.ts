import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * SQLite schema for sessions + messages. Timestamps are unix-ms integers;
 * the store converts to/from ISO strings at its boundary so the wire DTO
 * (`src/shared/chat.ts`) is unchanged.
 *
 * The message role list and the extra message columns (clientId, toolUseId,
 * agentKind, turnId, generation, rewindAt) are seeded now so later phases
 * (turn state machine, soft-delete/rewind, multi-harness) don't need a
 * migration. Only user/assistant/system are written in Phase 0.
 */

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  workspacePath: text('workspace_path'),
  projectId: text('project_id'),

  // Interrupted-turn detection (Phase 2): append-only, no clear op.
  activeTurnStartedAt: integer('active_turn_started_at'),
  lastTurnEndedAt: integer('last_turn_ended_at'),
  lastTurnOutcome: text('last_turn_outcome'),
  lastTurnError: text('last_turn_error'),

  // Resumable-stream cursor (Phase 2): monotonic per session.
  liveRevision: integer('live_revision').notNull().default(0),

  // Denormalised sidebar projection, maintained in the same write.
  listPreview: text('list_preview'),
  listPreviewRole: text('list_preview_role'),
  listMessageCount: integer('list_message_count').notNull().default(0),
});

export const messages = sqliteTable(
  'messages',
  {
    rowid: integer('rowid').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    clientId: text('client_id'),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: [
        'user',
        'assistant',
        'system',
        'tool_use',
        'tool_result',
        'thinking',
        'error',
        'agent_switch',
        'context_rebuild',
        'message_tombstone',
      ],
    }).notNull(),
    /** JSON string. For assistant rows may hold `{ text, parts }`. */
    content: text('content').notNull(),
    toolUseId: text('tool_use_id'),
    agentKind: text('agent_kind'),
    turnId: text('turn_id'),
    generation: integer('generation'),
    /** Soft-delete marker (unix-ms). Rewound rows stay as an audit trail. */
    rewindAt: integer('rewind_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    bySession: index('messages_session_idx').on(t.sessionId, t.rowid),
    activeBySession: index('messages_session_active_idx')
      .on(t.sessionId, t.rowid)
      .where(sql`${t.rewindAt} is null`),
  }),
);

/**
 * Session-scoped node canvas (slice C). One `canvases` row per session,
 * created lazily. `live_revision` is bumped in the same statement as every
 * node/edge mutation so a reconnecting client resumes from the gap. Columns
 * `params_hash` (dirty tracking) and node type `agent` are seeded now so P1
 * (topological executor) and P2 (agent-task node) need no migration.
 */
export const canvases = sqliteTable('canvases', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  liveRevision: integer('live_revision').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const canvasNodes = sqliteTable(
  'canvas_nodes',
  {
    id: text('id').primaryKey(),
    canvasId: text('canvas_id')
      .notNull()
      .references(() => canvases.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['image', 'agent'] }).notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    w: integer('w').notNull(),
    h: integer('h').notNull(),
    title: text('title').notNull().default(''),
    /** JSON blob of node params. */
    paramsJson: text('params_json').notNull().default('{}'),
    /** Stable hash of params + upstream refs. Seeded for P1 dirty tracking. */
    paramsHash: text('params_hash'),
    runState: text('run_state', { enum: ['idle', 'running', 'done', 'error'] })
      .notNull()
      .default('idle'),
    /** JSON blob of node output (`{ assets, text, error }`). */
    outputJson: text('output_json'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    byCanvas: index('canvas_nodes_canvas_idx').on(t.canvasId),
  }),
);

export const canvasEdges = sqliteTable(
  'canvas_edges',
  {
    id: text('id').primaryKey(),
    canvasId: text('canvas_id')
      .notNull()
      .references(() => canvases.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    sourceHandle: text('source_handle'),
    targetId: text('target_id').notNull(),
    targetHandle: text('target_handle'),
  },
  (t) => ({
    byCanvas: index('canvas_edges_canvas_idx').on(t.canvasId),
  }),
);

export type SessionRow = typeof sessions.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type CanvasRow = typeof canvases.$inferSelect;
export type CanvasNodeRow = typeof canvasNodes.$inferSelect;
export type CanvasEdgeRow = typeof canvasEdges.$inferSelect;
