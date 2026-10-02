CREATE TABLE canvas_commits (
  canvas_id text NOT NULL,
  revision integer NOT NULL,
  mutation_id text,
  changes_json text NOT NULL,
  created_at integer NOT NULL,
  PRIMARY KEY (canvas_id, revision),
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE cascade
);
