ALTER TABLE canvas_assets ADD COLUMN name text NOT NULL DEFAULT '';
ALTER TABLE canvas_assets ADD COLUMN folder text NOT NULL DEFAULT '';
ALTER TABLE canvas_assets ADD COLUMN tags_json text NOT NULL DEFAULT '[]';
UPDATE canvas_assets SET name = COALESCE((SELECT title FROM canvas_nodes WHERE canvas_nodes.id = canvas_assets.node_id), '');
CREATE INDEX canvas_assets_library_idx ON canvas_assets (kind, created_at DESC);
CREATE INDEX canvas_assets_folder_idx ON canvas_assets (folder);
