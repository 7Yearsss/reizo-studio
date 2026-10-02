CREATE TABLE canvas_jobs (
  id text PRIMARY KEY NOT NULL,
  canvas_id text NOT NULL,
  node_id text NOT NULL,
  node_type text NOT NULL,
  generation integer NOT NULL CHECK (generation >= 1),
  operation_id text,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
  input_json text NOT NULL,
  request_hash text NOT NULL,
  provider_id text,
  model text,
  input_hash text,
  result_json text,
  error text,
  cancel_reason text,
  created_at integer NOT NULL,
  submitted_at integer,
  ended_at integer,
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE cascade
);
CREATE UNIQUE INDEX canvas_jobs_generation_unique ON canvas_jobs (canvas_id, node_id, generation);
CREATE UNIQUE INDEX canvas_jobs_operation_unique ON canvas_jobs (canvas_id, operation_id) WHERE operation_id IS NOT NULL;
CREATE INDEX canvas_jobs_status_idx ON canvas_jobs (status);
