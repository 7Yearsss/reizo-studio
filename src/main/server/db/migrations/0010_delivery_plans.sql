CREATE TABLE delivery_plans (
  id text PRIMARY KEY NOT NULL,
  canvas_id text NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  skill_id text NOT NULL,
  contract_json text NOT NULL,
  plan_json text NOT NULL,
  manifest_json text NOT NULL,
  complete integer NOT NULL DEFAULT 0,
  issues_json text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE INDEX delivery_plans_canvas_idx ON delivery_plans (canvas_id, updated_at);
