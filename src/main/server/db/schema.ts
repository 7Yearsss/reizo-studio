import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
    type: text('type', {
      enum: [
        'image',
        'agent',
        'video',
        'audio',
        'note',
        'group',
        'anchor',
        'reroute',
        'frameExtractor',
        'section',
        'subgraph',
      ],
    }).notNull(),
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

/**
 * Session-scoped work-products (artifacts). Replaces the JSON-file store.
 * `artifacts` holds one row per logical deliverable; `artifact_versions` is
 * append-only history, each version tagged with the origin (`origin_json`)
 * that produced it — the prompt, surface, model. Text versions store content
 * inline (`content`); blob versions (images, video, audio) store a relative
 * `blob_path` under `<dataRoot>/artifacts/blobs/`.
 */
export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    // No FK: the JSON-only test app keeps sessions outside SQLite; cleanup runs
    // via removeBySession from the sessions router.
    sessionId: text('session_id').notNull(),
    projectId: text('project_id'),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    renderer: text('renderer').notNull(),
    status: text('status', { enum: ['streaming', 'complete', 'error'] })
      .notNull()
      .default('complete'),
    mimeType: text('mime_type').notNull(),
    source: text('source', { enum: ['attachment', 'generated', 'manual'] }).notNull(),
    currentVersion: integer('current_version').notNull().default(1),
    byteSize: integer('byte_size').notNull().default(0),
    originJson: text('origin_json'),
    metadataJson: text('metadata_json'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    bySession: index('artifacts_session_idx').on(t.sessionId, t.updatedAt),
  }),
);

export const artifactVersions = sqliteTable(
  'artifact_versions',
  {
    rowid: integer('rowid').primaryKey({ autoIncrement: true }),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    n: integer('n').notNull(),
    label: text('label').notNull(),
    originJson: text('origin_json').notNull(),
    byteSize: integer('byte_size').notNull(),
    contentDigest: text('content_digest').notNull(),
    storage: text('storage', { enum: ['inline', 'blob'] }).notNull(),
    content: text('content'),
    blobPath: text('blob_path'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    byArtifact: index('artifact_versions_artifact_idx').on(t.artifactId, t.n),
  }),
);

export const canvasCommandReceipts = sqliteTable('canvas_command_receipts', {
  canvasId: text('canvas_id').notNull().references(() => canvases.id, { onDelete: 'cascade' }),
  mutationId: text('mutation_id').notNull(),
  requestHash: text('request_hash').notNull(),
  resultJson: text('result_json').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => ({ key: primaryKey({ columns: [t.canvasId, t.mutationId] }) }));

export const canvasCommits = sqliteTable('canvas_commits', {
  canvasId: text('canvas_id').notNull().references(() => canvases.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  mutationId: text('mutation_id'),
  changesJson: text('changes_json').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => ({ key: primaryKey({ columns: [t.canvasId, t.revision] }) }));

/** Durable execution history survives node deletion and is removed with its canvas. */
export const canvasJobs = sqliteTable('canvas_jobs', {
  id: text('id').primaryKey(),
  canvasId: text('canvas_id').notNull().references(() => canvases.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull(),
  nodeType: text('node_type').notNull(),
  generation: integer('generation').notNull(),
  operationId: text('operation_id'),
  status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'] }).notNull(),
  inputJson: text('input_json').notNull(),
  requestHash: text('request_hash').notNull(),
  providerId: text('provider_id'),
  model: text('model'),
  inputHash: text('input_hash'),
  remoteTaskJson: text('remote_task_json'),
  resultJson: text('result_json'),
  error: text('error'),
  cancelReason: text('cancel_reason'),
  createdAt: integer('created_at').notNull(),
  submittedAt: integer('submitted_at'),
  endedAt: integer('ended_at'),
}, (t) => ({
  generationKey: uniqueIndex('canvas_jobs_generation_unique').on(t.canvasId, t.nodeId, t.generation),
  operationKey: uniqueIndex('canvas_jobs_operation_unique').on(t.canvasId, t.operationId).where(sql`${t.operationId} IS NOT NULL`),
  byStatus: index('canvas_jobs_status_idx').on(t.status),
  generationCheck: check('canvas_jobs_generation_check', sql`${t.generation} >= 1`),
  statusCheck: check('canvas_jobs_status_check', sql`${t.status} IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')`),
}));

/** Origin identifiers are historical metadata, independent of source document deletion. */
export const canvasAssets = sqliteTable('canvas_assets', {
  id: text('id').primaryKey(),
  path: text('path').notNull(),
  canvasId: text('canvas_id').notNull(),
  nodeId: text('node_id'),
  kind: text('kind', { enum: ['image', 'video', 'audio', 'mask'] }).notNull(),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  contentHash: text('content_hash').notNull(),
  source: text('source', { enum: ['generated', 'imported', 'mask'] }).notNull(),
  createdAt: integer('created_at').notNull(),
  jobId: text('job_id'),
  generation: integer('generation'),
  providerId: text('provider_id'),
  model: text('model'),
  inputHash: text('input_hash'),
}, (t) => ({
  pathKey: uniqueIndex('canvas_assets_path_unique').on(t.path),
  byOrigin: index('canvas_assets_origin_idx').on(t.canvasId, t.createdAt),
  kindCheck: check('canvas_assets_kind_check', sql`${t.kind} IN ('image', 'video', 'audio', 'mask')`),
  sourceCheck: check('canvas_assets_source_check', sql`${t.source} IN ('generated', 'imported', 'mask')`),
  sizeCheck: check('canvas_assets_size_check', sql`${t.byteSize} >= 0`),
}));

export type SessionRow = typeof sessions.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type CanvasRow = typeof canvases.$inferSelect;
export type CanvasNodeRow = typeof canvasNodes.$inferSelect;
export type CanvasEdgeRow = typeof canvasEdges.$inferSelect;
export type CanvasJobRow = typeof canvasJobs.$inferSelect;
export type CanvasAssetRow = typeof canvasAssets.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type ArtifactVersionRow = typeof artifactVersions.$inferSelect;
