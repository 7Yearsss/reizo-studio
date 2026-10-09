CREATE TABLE artifact_reviews (
  id text PRIMARY KEY NOT NULL,
  artifact_id text NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  review_version integer NOT NULL DEFAULT 1,
  payload_json text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE INDEX artifact_reviews_artifact_idx ON artifact_reviews(artifact_id, created_at);
