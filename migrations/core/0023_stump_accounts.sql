-- Connected network accounts, owned by one person or the company (D-1, STUMP-PUBLISH-001).
-- Credentials are sealed by the publishing lane and never leave the installation.
CREATE TABLE stump_accounts (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT,
  owner_kind TEXT NOT NULL CHECK(owner_kind IN ('person','company')),
  owner_person_id TEXT,
  connected_by TEXT,
  connected_at INTEGER,
  state TEXT NOT NULL DEFAULT 'pending',
  reconnect_url TEXT,
  instance TEXT,
  credentials TEXT,
  follower_count INTEGER,
  automated_label INTEGER NOT NULL DEFAULT 0 CHECK(automated_label IN (0,1)),
  operator_bio TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((owner_kind = 'person') = (owner_person_id IS NOT NULL))
);
CREATE INDEX stump_accounts_owner ON stump_accounts(owner_person_id);

-- Queue slots per account (STUMP-PLAN-002).
CREATE TABLE stump_queue_slots (
  account_id TEXT PRIMARY KEY,
  time_zone TEXT NOT NULL,
  slots TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(slots)),
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
