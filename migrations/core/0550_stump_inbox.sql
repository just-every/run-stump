-- The inbox (STUMP-INBOX-001, STUMP-INBOX-002) and engagers offered to Orbit
-- (STUMP-STACK-002). Block 0550-0599.

-- One row per post that reached a connected account: a mention, a reply to one of
-- the account's posts, a quote, or the post of a public thread a mention answered
-- (kind 'thread', kept for context). Each arrives once per account.
CREATE TABLE stump_inbox_items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  network TEXT NOT NULL,
  network_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('mention','reply','quote','thread')),
  url TEXT NOT NULL,
  text TEXT NOT NULL,
  author_id TEXT,
  author_handle TEXT,
  author_name TEXT,
  conversation_id TEXT,
  -- The post this one answers, and whether it is the account's own (the company post they answered).
  parent_network_id TEXT,
  parent_url TEXT,
  parent_own INTEGER NOT NULL DEFAULT 0 CHECK(parent_own IN (0,1)),
  -- True only when the author engaged with the account first: mentioned it, replied to it or quoted it (D-4).
  engaged_first INTEGER NOT NULL CHECK(engaged_first IN (0,1)),
  -- What the person did, when it was more than a passing reaction (STUMP-STACK-002).
  engagement TEXT,
  occurred_at INTEGER,
  received_at INTEGER NOT NULL,
  -- The item that answers it, and the offer that takes its author to Orbit.
  reply_item_id TEXT,
  offer_id TEXT,
  UNIQUE(account_id, network_id)
);
CREATE INDEX stump_inbox_items_account ON stump_inbox_items(account_id, occurred_at);
CREATE INDEX stump_inbox_items_reply ON stump_inbox_items(reply_item_id);

-- Where each account's next read starts, and what the last one read and cost.
CREATE TABLE stump_inbox_cursors (
  account_id TEXT PRIMARY KEY,
  cursor TEXT,
  polled_at INTEGER NOT NULL,
  polled_by TEXT,
  reads INTEGER NOT NULL DEFAULT 0,
  charge_micro INTEGER NOT NULL DEFAULT 0,
  last_error TEXT CHECK(last_error IS NULL OR json_valid(last_error))
);

-- The network's own id for an engager, so the same person keeps one identity in Orbit
-- when their handle changes.
ALTER TABLE stump_stack_offers ADD COLUMN network_user_id TEXT;
