PRAGMA foreign_keys = ON;
CREATE TABLE categories (
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE resources (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
 category_id TEXT REFERENCES categories(id) ON DELETE SET NULL, tags TEXT NOT NULL DEFAULT '',
 cover_key TEXT NOT NULL DEFAULT '', format TEXT NOT NULL DEFAULT '', size TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
 featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)), demo INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_resources_public ON resources(status,featured DESC,updated_at DESC);
CREATE INDEX idx_resources_category ON resources(category_id,status,updated_at DESC);
CREATE TABLE links (
 id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
 provider TEXT NOT NULL, url TEXT NOT NULL, code TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')), position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_links_resource ON links(resource_id,position);
CREATE TABLE reports (
 id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
 reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_reports_status ON reports(status,created_at DESC);
CREATE TABLE daily_clicks (
 day TEXT NOT NULL, resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
 provider TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'direct', count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(day,resource_id,provider,channel)
);
CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE report_limits (fingerprint TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
