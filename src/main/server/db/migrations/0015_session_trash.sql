ALTER TABLE sessions ADD COLUMN deleted_at integer;
CREATE INDEX sessions_deleted_idx ON sessions(deleted_at);
