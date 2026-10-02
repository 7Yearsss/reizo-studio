CREATE TABLE canvas_assets (
  id text PRIMARY KEY NOT NULL,
  path text NOT NULL,
  canvas_id text NOT NULL,
  node_id text,
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'mask')),
  mime_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size >= 0),
  content_hash text NOT NULL,
  source text NOT NULL CHECK (source IN ('generated', 'imported', 'mask')),
  created_at integer NOT NULL,
  job_id text,
  generation integer,
  provider_id text,
  model text,
  input_hash text
);
CREATE UNIQUE INDEX canvas_assets_path_unique ON canvas_assets (path);
CREATE INDEX canvas_assets_origin_idx ON canvas_assets (canvas_id, created_at);
