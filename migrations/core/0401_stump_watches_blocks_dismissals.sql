-- The company's author block list (STUMP-WATCH-013.4): one list for every watch, keyed by source and
-- handle. source '' blocks the handle on every source. Every watch's poll screens against it, so
-- stump_watches.blocked_authors (0026) is no longer read.
CREATE TABLE stump_blocked_authors (
  source TEXT NOT NULL DEFAULT '' CHECK(source IN ('', 'hn', 'rss', 'bluesky', 'mastodon')),
  handle TEXT NOT NULL CHECK(length(handle) BETWEEN 1 AND 300),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (source, handle)
);

-- A dismissed finding (STUMP-WATCH-001.3) keeps its row, so its canonical URL never returns as a new
-- finding, and leaves the list. Who dismissed it and when stay on the row.
ALTER TABLE stump_findings ADD COLUMN dismissed_at INTEGER;
ALTER TABLE stump_findings ADD COLUMN dismissed_by TEXT;
CREATE INDEX stump_findings_watch_state ON stump_findings(watch_id, state);
