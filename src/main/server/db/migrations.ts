/**
 * Ordered migrations, embedded as strings so they survive bundling (vite
 * main build) and run identically under tsx. The canonical SQL also lives in
 * `./migrations/*.sql` for `drizzle-kit generate` diffing; keep the two in
 * sync when adding a migration. Never edit a migration once shipped — append
 * a new one.
 */
export interface Migration {
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    name: '0000_init',
    statements: [
      `CREATE TABLE sessions (
        id text PRIMARY KEY NOT NULL,
        title text NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        workspace_path text,
        project_id text,
        active_turn_started_at integer,
        last_turn_ended_at integer,
        live_revision integer DEFAULT 0 NOT NULL,
        list_preview text,
        list_preview_role text,
        list_message_count integer DEFAULT 0 NOT NULL
      )`,
      `CREATE TABLE messages (
        rowid integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        id text NOT NULL,
        client_id text,
        session_id text NOT NULL,
        role text NOT NULL,
        content text NOT NULL,
        tool_use_id text,
        agent_kind text,
        turn_id text,
        generation integer,
        rewind_at integer,
        created_at integer NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON UPDATE no action ON DELETE cascade
      )`,
      `CREATE UNIQUE INDEX messages_id_unique ON messages (id)`,
      `CREATE INDEX messages_session_idx ON messages (session_id, rowid)`,
      `CREATE INDEX messages_session_active_idx ON messages (session_id, rowid) WHERE rewind_at IS NULL`,
    ],
  },
  {
    name: '0001_turn_outcomes',
    statements: [
      `ALTER TABLE sessions ADD COLUMN last_turn_outcome text`,
      `ALTER TABLE sessions ADD COLUMN last_turn_error text`,
    ],
  },
  {
    name: '0002_canvas',
    statements: [
      `CREATE TABLE canvases (
        id text PRIMARY KEY NOT NULL,
        session_id text NOT NULL,
        live_revision integer DEFAULT 0 NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON UPDATE no action ON DELETE cascade
      )`,
      `CREATE TABLE canvas_nodes (
        id text PRIMARY KEY NOT NULL,
        canvas_id text NOT NULL,
        type text NOT NULL,
        x integer NOT NULL,
        y integer NOT NULL,
        w integer NOT NULL,
        h integer NOT NULL,
        title text DEFAULT '' NOT NULL,
        params_json text DEFAULT '{}' NOT NULL,
        params_hash text,
        run_state text DEFAULT 'idle' NOT NULL,
        output_json text,
        updated_at integer NOT NULL,
        FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON UPDATE no action ON DELETE cascade
      )`,
      `CREATE TABLE canvas_edges (
        id text PRIMARY KEY NOT NULL,
        canvas_id text NOT NULL,
        source_id text NOT NULL,
        source_handle text,
        target_id text NOT NULL,
        target_handle text,
        FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON UPDATE no action ON DELETE cascade
      )`,
      `CREATE INDEX canvas_nodes_canvas_idx ON canvas_nodes (canvas_id)`,
      `CREATE INDEX canvas_edges_canvas_idx ON canvas_edges (canvas_id)`,
    ],
  },
];
