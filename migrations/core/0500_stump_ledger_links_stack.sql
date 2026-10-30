-- Ledger corrections, the company's link rules and the connections to Orbit and Vane
-- (STUMP-LEDGER-001/002, STUMP-LINK-001, STUMP-STACK-002/004). Block 0500-0549.

-- A removal keeps the entry on the record with who marked it and why (STUMP-LEDGER-001.5).
ALTER TABLE stump_ledger ADD COLUMN removal TEXT CHECK(removal IS NULL OR json_valid(removal));
CREATE INDEX stump_ledger_campaign ON stump_ledger(campaign);

-- The company's naming rules for tagged links, one row (STUMP-LINK-001).
CREATE TABLE stump_link_rules (
  id TEXT PRIMARY KEY CHECK(id = 'rules'),
  own_domains TEXT NOT NULL CHECK(json_valid(own_domains)),
  mediums TEXT NOT NULL CHECK(json_valid(mediums)),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One connection per sibling seed (orbit, vane). The secret is sealed under the
-- installation key and is never answered back.
CREATE TABLE stump_stack_connections (
  seed TEXT PRIMARY KEY CHECK(seed IN ('orbit','vane')),
  origin TEXT NOT NULL,
  external_id TEXT NOT NULL,
  secret_sealed TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'connected' CHECK(state IN ('connected','disconnected')),
  connected_by TEXT NOT NULL,
  connected_at INTEGER NOT NULL,
  disconnected_at INTEGER,
  last_sent_at INTEGER,
  last_error TEXT
);

-- What Stump has to send to a sibling seed: an engager for Orbit, a ledger entry's
-- annotation for Vane. The inbox lane adds engager offers; the outcome of every send
-- is recorded on the row (STUMP-STACK-002, STUMP-STACK-004).
CREATE TABLE stump_stack_offers (
  id TEXT PRIMARY KEY,
  seed TEXT NOT NULL CHECK(seed IN ('orbit','vane')),
  kind TEXT NOT NULL CHECK(kind IN ('engager','annotation')),
  state TEXT NOT NULL DEFAULT 'offered' CHECK(state IN ('offered','sent','failed','dismissed')),
  ledger_id TEXT,
  network TEXT,
  handle TEXT,
  display_name TEXT,
  post_url TEXT,
  engagement TEXT,
  public_email TEXT,
  occurred_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  outcome TEXT CHECK(outcome IS NULL OR json_valid(outcome)),
  created_by TEXT,
  created_at INTEGER NOT NULL,
  sent_by TEXT,
  sent_at INTEGER,
  CHECK(kind <> 'engager' OR (seed = 'orbit' AND network IS NOT NULL AND handle IS NOT NULL AND post_url IS NOT NULL)),
  CHECK(kind <> 'annotation' OR (seed = 'vane' AND ledger_id IS NOT NULL))
);
CREATE INDEX stump_stack_offers_state ON stump_stack_offers(state, created_at);
-- A ledger entry has one Vane annotation; a person has one open offer per post.
CREATE UNIQUE INDEX stump_stack_offers_annotation ON stump_stack_offers(ledger_id) WHERE kind = 'annotation';
CREATE UNIQUE INDEX stump_stack_offers_engager ON stump_stack_offers(network, handle, post_url) WHERE kind = 'engager';
