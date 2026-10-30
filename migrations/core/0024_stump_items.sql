-- Items: posts, threads, replies and pitches, with revisions and their state.
-- States: draft ready scheduled posting posted partly_posted failed uncertain held paused cancelled.
CREATE TABLE stump_items (
  id TEXT PRIMARY KEY,
  format TEXT NOT NULL CHECK(format IN ('post','thread','reply','pitch')),
  network TEXT,
  account_id TEXT,
  venue_id TEXT,
  person_id TEXT NOT NULL,
  product_id TEXT,
  master_id TEXT,
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','ready','scheduled','posting','posted','partly_posted','failed','uncertain','held','paused','cancelled')),
  revision INTEGER NOT NULL DEFAULT 1,
  text TEXT,
  parts TEXT CHECK(parts IS NULL OR json_valid(parts)),
  flags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(flags)),
  routes TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(routes)),
  claims_used TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(claims_used)),
  sources TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(sources)),
  ai TEXT CHECK(ai IS NULL OR json_valid(ai)),
  url TEXT,
  network_id TEXT,
  scheduled_at INTEGER,
  time_zone TEXT,
  posted_at INTEGER,
  hold TEXT CHECK(hold IS NULL OR json_valid(hold)),
  error TEXT CHECK(error IS NULL OR json_valid(error)),
  recipient TEXT CHECK(recipient IS NULL OR json_valid(recipient)),
  subject TEXT,
  reply_to TEXT CHECK(reply_to IS NULL OR json_valid(reply_to)),
  differs_from_master INTEGER NOT NULL DEFAULT 0 CHECK(differs_from_master IN (0,1)),
  campaign TEXT,
  options TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(options)),
  -- The agent that prepared it ({id,name}) and who approved it, for the ledger's "<agent> for <person>".
  agent TEXT CHECK(agent IS NULL OR json_valid(agent)),
  approved_by TEXT CHECK(approved_by IS NULL OR json_valid(approved_by)),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX stump_items_due ON stump_items(state, scheduled_at);
CREATE INDEX stump_items_account ON stump_items(account_id);
CREATE INDEX stump_items_person ON stump_items(person_id);
CREATE INDEX stump_items_master ON stump_items(master_id);

CREATE TABLE stump_item_revisions (
  item_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  text TEXT,
  parts TEXT CHECK(parts IS NULL OR json_valid(parts)),
  saved_by TEXT NOT NULL,
  agent_id TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (item_id, revision)
);

CREATE TABLE stump_item_history (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  person_id TEXT,
  agent_id TEXT,
  reason TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX stump_item_history_item ON stump_item_history(item_id, at);
