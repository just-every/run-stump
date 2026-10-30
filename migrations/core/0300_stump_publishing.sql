-- Publishing and scheduling (STUMP-PUBLISH-001 to -006, STUMP-CONNECT-001, -002, STUMP-PLAN-002).

-- The company's own network apps (STUMP-CONNECT-002): keys sealed with the
-- installation key, and the price table the company keeps for X.
CREATE TABLE stump_network_apps (
  network TEXT PRIMARY KEY CHECK(network IN ('x','linkedin')),
  client_id TEXT,
  client_secret TEXT,
  prices TEXT CHECK(prices IS NULL OR json_valid(prices)),
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);

-- Stump's app on each Mastodon instance, registered on first use (sealed).
CREATE TABLE stump_mastodon_apps (
  origin TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  registration TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (origin, redirect_uri)
);

-- A consent in progress: bound to the person who asked for it (STUMP-PUBLISH-001.4).
-- pending holds the sealed PKCE verifier, DPoP key or app-password step.
CREATE TABLE stump_connections (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL,
  owner_kind TEXT NOT NULL CHECK(owner_kind IN ('person','company')),
  person_id TEXT NOT NULL,
  agent_id TEXT,
  account_id TEXT,
  method TEXT NOT NULL CHECK(method IN ('oauth','app_password')),
  pending TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX stump_connections_person ON stump_connections(person_id, created_at);

-- What the network says about a connected account, and the network's own id for it:
-- one network account has one owner (STUMP-PUBLISH-001).
ALTER TABLE stump_accounts ADD COLUMN network_user_id TEXT;
ALTER TABLE stump_accounts ADD COLUMN bot INTEGER NOT NULL DEFAULT 0 CHECK(bot IN (0,1));
ALTER TABLE stump_accounts ADD COLUMN bot_rules TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(bot_rules));
ALTER TABLE stump_accounts ADD COLUMN post_limit INTEGER;
ALTER TABLE stump_accounts ADD COLUMN token_expires_at INTEGER;
ALTER TABLE stump_accounts ADD COLUMN disconnected_at INTEGER;
ALTER TABLE stump_accounts ADD COLUMN disconnected_by TEXT;
CREATE UNIQUE INDEX stump_accounts_network_user ON stump_accounts(network, network_user_id) WHERE network_user_id IS NOT NULL;

-- Who scheduled an item, and whether it sits in a queue slot (STUMP-PLAN-002).
ALTER TABLE stump_items ADD COLUMN scheduled_by TEXT CHECK(scheduled_by IS NULL OR json_valid(scheduled_by));
ALTER TABLE stump_items ADD COLUMN queued INTEGER NOT NULL DEFAULT 0 CHECK(queued IN (0,1));

-- Each part of a post or thread as it lands, so a thread that stops part way
-- resumes with the rest exactly once (STUMP-PUBLISH-002.3, -004.4).
CREATE TABLE stump_item_parts (
  item_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  network_id TEXT NOT NULL,
  url TEXT NOT NULL,
  ref TEXT CHECK(ref IS NULL OR json_valid(ref)),
  text TEXT,
  posted_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, account_id, part)
);

-- Every call Stump makes to a network for an account, with its charge from the
-- company's price table (STUMP-SURFACE-004) and LinkedIn's per-member day count.
CREATE TABLE stump_network_calls (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  account_id TEXT,
  item_id TEXT,
  act TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  usd_micro INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);
CREATE INDEX stump_network_calls_account ON stump_network_calls(account_id, at);
CREATE INDEX stump_network_calls_item ON stump_network_calls(item_id);

CREATE UNIQUE INDEX stump_ledger_item ON stump_ledger(item_id, account_id) WHERE item_id IS NOT NULL AND route = 'published';
CREATE INDEX stump_media_position ON stump_media(item_id, created_at);
