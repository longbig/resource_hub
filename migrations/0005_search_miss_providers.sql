-- Older records did not store the searched provider; preserve them as unclassified.
CREATE TABLE search_misses_by_provider (
  keyword TEXT NOT NULL,
  provider TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  first_searched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_searched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (keyword,provider)
);
INSERT INTO search_misses_by_provider(keyword,provider,count,first_searched_at,last_searched_at)
SELECT keyword,'unknown',count,first_searched_at,last_searched_at FROM search_misses;

CREATE TABLE network_result_clicks_by_provider (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  provider TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  clicked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (keyword,provider) REFERENCES search_misses_by_provider(keyword,provider)
);
INSERT INTO network_result_clicks_by_provider(id,keyword,provider,title,url,clicked_at)
SELECT id,keyword,'unknown',title,url,clicked_at FROM network_result_clicks;

-- Drop the old child before its parent so foreign-key checks stay enabled.
DROP TABLE network_result_clicks;
DROP TABLE search_misses;
ALTER TABLE search_misses_by_provider RENAME TO search_misses;
ALTER TABLE network_result_clicks_by_provider RENAME TO network_result_clicks;

CREATE INDEX idx_search_misses_recent ON search_misses(last_searched_at DESC,keyword,provider);
CREATE INDEX idx_search_misses_provider_recent ON search_misses(provider,last_searched_at DESC,keyword);
CREATE INDEX idx_network_clicks_keyword ON network_result_clicks(keyword,provider,clicked_at DESC);
