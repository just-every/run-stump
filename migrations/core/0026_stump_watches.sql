-- Watches and their findings (STUMP-WATCH-001 to -005, -013). Found text is data (D-7).
CREATE TABLE stump_watches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  product_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(product_ids)),
  terms TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(terms)),
  sources TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(sources)),
  alerts TEXT CHECK(alerts IS NULL OR json_valid(alerts)),
  blocked_authors TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(blocked_authors)),
  muted_until INTEGER,
  last_error TEXT CHECK(last_error IS NULL OR json_valid(last_error)),
  next_poll_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE stump_findings (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  url_key TEXT NOT NULL,
  title TEXT,
  text TEXT,
  author TEXT,
  points INTEGER,
  published_at INTEGER,
  relevance REAL,
  reasons TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reasons)),
  routes TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(routes)),
  backfill INTEGER NOT NULL DEFAULT 0 CHECK(backfill IN (0,1)),
  mentions TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(mentions)),
  state TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL,
  UNIQUE (watch_id, url_key)
);
CREATE INDEX stump_findings_watch ON stump_findings(watch_id, published_at);
