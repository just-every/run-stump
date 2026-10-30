-- Product refusals (D-1 to D-8) with their rule and source, for people and agents alike,
-- apart from the agent door's policy decisions (STUMP-SURFACE-010.3).
CREATE TABLE stump_refusals (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  tool TEXT NOT NULL,
  action TEXT NOT NULL,
  rule TEXT NOT NULL,
  source TEXT NOT NULL,
  person_id TEXT NOT NULL,
  agent_id TEXT,
  door TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail)),
  at INTEGER NOT NULL
);
CREATE INDEX stump_refusals_at ON stump_refusals(at);
