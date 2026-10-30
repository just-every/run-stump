-- Publishing Pause (STUMP-PLAN-007): one row per paused scope ('all' or 'account:<id>').
CREATE TABLE stump_pause (
  scope_key TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('all','account')),
  account_id TEXT,
  person_id TEXT NOT NULL,
  agent_id TEXT,
  paused_at INTEGER NOT NULL,
  CHECK ((scope = 'account') = (account_id IS NOT NULL))
);

CREATE TABLE stump_pause_history (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK(action IN ('pause','resume')),
  scope TEXT NOT NULL CHECK(scope IN ('all','account')),
  account_id TEXT,
  person_id TEXT NOT NULL,
  agent_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail)),
  at INTEGER NOT NULL
);
CREATE INDEX stump_pause_history_at ON stump_pause_history(at);
