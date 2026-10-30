-- Hand-offs: a brief and a draft for the named member who posts by hand (STUMP-HANDOFF-001 to -003).
-- States: open join_first held posted skipped expired.
CREATE TABLE stump_handoffs (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  venue_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  product_id TEXT,
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','join_first','held','posted','skipped','expired')),
  due_at INTEGER,
  lapse TEXT CHECK(lapse IS NULL OR lapse IN ('expire','reassign','next_slot')),
  rules TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(rules)),
  facts TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(facts)),
  disclosure_line TEXT,
  draft_text TEXT,
  talking_points TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(talking_points)),
  own_words TEXT,
  own_words_required INTEGER NOT NULL DEFAULT 0 CHECK(own_words_required IN (0,1)),
  attestation_required INTEGER NOT NULL DEFAULT 0 CHECK(attestation_required IN (0,1)),
  join_steps TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(join_steps)),
  next_open_at INTEGER,
  hold TEXT CHECK(hold IS NULL OR json_valid(hold)),
  thread_url TEXT,
  url TEXT,
  ledger_id TEXT,
  campaign TEXT,
  agent TEXT CHECK(agent IS NULL OR json_valid(agent)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX stump_handoffs_person ON stump_handoffs(person_id, state);
CREATE INDEX stump_handoffs_venue ON stump_handoffs(venue_id);

CREATE TABLE stump_handoff_history (
  id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  person_id TEXT,
  agent_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail)),
  at INTEGER NOT NULL
);
CREATE INDEX stump_handoff_history_handoff ON stump_handoff_history(handoff_id, at);

-- The ledger: every published and handed-off post (STUMP-LEDGER-001, -002).
-- Routes: published handed_off orbit mango. States: posted failed uncertain deleted removed.
CREATE TABLE stump_ledger (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  handoff_id TEXT,
  url TEXT,
  network TEXT,
  network_id TEXT,
  venue_id TEXT,
  account_id TEXT,
  person_id TEXT,
  agent TEXT CHECK(agent IS NULL OR json_valid(agent)),
  by_label TEXT NOT NULL,
  text TEXT,
  disclosure_line TEXT,
  claims TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(claims)),
  product_id TEXT,
  campaign TEXT,
  route TEXT NOT NULL CHECK(route IN ('published','handed_off','orbit','mango')),
  state TEXT NOT NULL CHECK(state IN ('posted','failed','uncertain','deleted','removed')),
  confirmation TEXT CHECK(confirmation IS NULL OR confirmation IN ('network','person')),
  revision INTEGER,
  posted_at INTEGER,
  charge_usd REAL,
  approved_by TEXT CHECK(approved_by IS NULL OR json_valid(approved_by)),
  hold TEXT CHECK(hold IS NULL OR json_valid(hold)),
  legal_hold TEXT CHECK(legal_hold IS NULL OR json_valid(legal_hold)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX stump_ledger_posted ON stump_ledger(posted_at);
CREATE INDEX stump_ledger_venue ON stump_ledger(venue_id);
CREATE INDEX stump_ledger_person ON stump_ledger(person_id);

CREATE TABLE stump_ledger_versions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  text TEXT,
  note TEXT,
  fields TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(fields)),
  person_id TEXT,
  agent_id TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX stump_ledger_versions_entry ON stump_ledger_versions(entry_id, at);
