-- Polling, per-source state and alert deliveries for watches (STUMP-WATCH-001 to -005, -013).
-- stump_watches holds the watch, stump_findings what it found (0026); these add what polling needs.
ALTER TABLE stump_watches ADD COLUMN interval_minutes INTEGER NOT NULL DEFAULT 15 CHECK(interval_minutes BETWEEN 5 AND 1440);
ALTER TABLE stump_watches ADD COLUMN muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0,1));
-- A poll holds this lease so two scheduled ticks never poll one watch at once.
ALTER TABLE stump_watches ADD COLUMN lease_until INTEGER;
CREATE INDEX stump_watches_due ON stump_watches(next_poll_at);

-- The finding as its source gave it (sanitised text, links, counts), so ranking and mentions are
-- computed on read from the current terms, products and time. source_key names the configured source.
ALTER TABLE stump_findings ADD COLUMN raw TEXT CHECK(raw IS NULL OR json_valid(raw));
ALTER TABLE stump_findings ADD COLUMN source_key TEXT;

-- One row per configured source: cursors, HTTP validators, and when it may be polled again.
-- backfilled_at is NULL until the source's 30-day backfill ran; a filter change clears it, so
-- the next poll re-reads the source's history (those findings raise no immediate alert).
CREATE TABLE stump_watch_sources (
  watch_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(state)),
  next_poll_at INTEGER,
  blocked_until INTEGER,
  last_polled_at INTEGER,
  backfilled_at INTEGER,
  failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT CHECK(last_error IS NULL OR json_valid(last_error)),
  PRIMARY KEY (watch_id, source_key)
);

-- Immediate alerts. The message is kept so a replay sends the same event id and the same body.
CREATE TABLE stump_watch_deliveries (
  event_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('slack','webhook')),
  watch_id TEXT NOT NULL,
  finding_id TEXT,
  message TEXT NOT NULL CHECK(json_valid(message)),
  state TEXT NOT NULL CHECK(state IN ('pending','delivered','retry','rejected','unknown')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT CHECK(last_error IS NULL OR json_valid(last_error)),
  last_attempt_at INTEGER,
  next_attempt_at INTEGER,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, channel)
);
CREATE INDEX stump_watch_deliveries_watch ON stump_watch_deliveries(watch_id, created_at);
CREATE INDEX stump_watch_deliveries_retry ON stump_watch_deliveries(state, next_attempt_at);
