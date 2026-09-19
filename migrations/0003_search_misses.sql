CREATE TABLE IF NOT EXISTS search_misses (
  keyword TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  first_searched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_searched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_search_misses_recent ON search_misses(last_searched_at DESC);
