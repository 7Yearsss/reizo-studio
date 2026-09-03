-- 0003_artifacts: SQLite-backed work-product store with append-only version
-- history. Replaces the JSON-file artifactStore. Text versions store content
-- inline; blob versions (image/video/audio/binary) reference a file under
-- <dataRoot>/artifacts/blobs/. Keep in sync with migrations.ts.

CREATE TABLE artifacts (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL,
  project_id text,
  name text NOT NULL,
  kind text NOT NULL,
  renderer text NOT NULL,
  status text DEFAULT 'complete' NOT NULL,
  mime_type text NOT NULL,
  source text NOT NULL,
  current_version integer DEFAULT 1 NOT NULL,
  byte_size integer DEFAULT 0 NOT NULL,
  origin_json text,
  metadata_json text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE artifact_versions (
  rowid integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  artifact_id text NOT NULL,
  n integer NOT NULL,
  label text NOT NULL,
  origin_json text NOT NULL,
  byte_size integer NOT NULL,
  content_digest text NOT NULL,
  storage text NOT NULL,
  content text,
  blob_path text,
  created_at integer NOT NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX artifacts_session_idx ON artifacts (session_id, updated_at);
CREATE INDEX artifact_versions_artifact_idx ON artifact_versions (artifact_id, n);
CREATE UNIQUE INDEX artifact_versions_unique ON artifact_versions (artifact_id, n);
