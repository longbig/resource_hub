CREATE TABLE resource_requests (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_resource_requests_status ON resource_requests(status,created_at DESC);
