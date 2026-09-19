CREATE TABLE network_result_clicks (
 id TEXT PRIMARY KEY,
 keyword TEXT NOT NULL REFERENCES search_misses(keyword),
 title TEXT NOT NULL,
 url TEXT NOT NULL,
 clicked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_network_clicks_keyword ON network_result_clicks(keyword,clicked_at DESC);
