-- What an erasure leaves so the erased person's findings stay erased (STUMP-DATA-002). Block 0600-0699.
-- Each row holds a SHA-256 digest, never the address or handle itself: a finding's canonical address,
-- so the same post is not stored again by any watch, and an engager's handle or author id on one
-- source, so their other posts are not collected either. Both travel in the archive, so a restore
-- keeps the erasure in force.
CREATE TABLE stump_erased_findings (
  key_hash TEXT PRIMARY KEY,
  erasure_id TEXT NOT NULL
);
CREATE TABLE stump_erased_authors (
  source TEXT NOT NULL,
  handle_hash TEXT NOT NULL,
  erasure_id TEXT NOT NULL,
  PRIMARY KEY (source, handle_hash)
);

-- An erased engager's offers that had already gone to a seed: [{offer_id, seed, sent_at, event_id,
-- signal_id, outcome}]. The seed keeps the contact, so the operator erases them there too; these are
-- references only, never the person's handle, name or email.
ALTER TABLE stump_erasures ADD COLUMN sent_to_seeds TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(sent_to_seeds));
