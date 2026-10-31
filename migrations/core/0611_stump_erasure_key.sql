-- The installation's erasure key (STUMP-DATA-002). Block 0600-0699. Tombstones written from now on
-- are HMAC-SHA-256 digests under this key, so a digest cannot be matched to a guessed handle or
-- address without it. One row, made by the first erasure that needs it. It travels in the archive
-- with the tombstones, so a restore keeps every erasure in force. Tombstones written before the
-- key existed stay as they are and are still matched.
CREATE TABLE stump_erasure_key (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  key TEXT NOT NULL CHECK(length(key) = 64),
  created_at INTEGER NOT NULL
);
