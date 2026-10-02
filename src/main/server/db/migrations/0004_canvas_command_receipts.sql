CREATE TABLE canvas_command_receipts (
  canvas_id text NOT NULL,
  mutation_id text NOT NULL,
  request_hash text NOT NULL,
  result_json text NOT NULL,
  created_at integer NOT NULL,
  PRIMARY KEY (canvas_id, mutation_id),
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE cascade
);
