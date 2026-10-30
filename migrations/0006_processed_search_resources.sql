-- Track processed source shares independently of the search-miss schema.
-- Removing a resource removes its marker, so its source can be exported again.
CREATE TABLE IF NOT EXISTS processed_search_resources (
  source_identity TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_processed_search_resources_resource ON processed_search_resources(resource_id);
