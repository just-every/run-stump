-- Switching from Buffer (STUMP-IMPORT-001) and erasure of a person (STUMP-DATA-002). Block 0600-0699.

-- Results a ledger entry arrived with from the tool it was imported from: {source, values, read_at}.
-- Buffer's statistics on a sent post read as imported results, never as Stump's own reads.
ALTER TABLE stump_ledger ADD COLUMN results TEXT CHECK(results IS NULL OR json_valid(results));

-- What the Buffer import wrote, per target: the kit's applied revision, the exact value it
-- wrote, and the native marker right after, so any later edit in Stump reads as an edit
-- (kept on Undo, named on a rerun). kind is account, slots, ledger_entry or item.
CREATE TABLE stump_buffer_imports (
  target_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('account','slots','ledger_entry','item')),
  native_id TEXT NOT NULL,
  kit_revision TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  native_marker TEXT NOT NULL
);
CREATE UNIQUE INDEX stump_buffer_imports_native ON stump_buffer_imports(kind, native_id);

-- Each erasure, audited without the erased data: what kind of person, how many records
-- of each kind left, and the delete request sent for each ledger entry with its outcome.
CREATE TABLE stump_erasures (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('journalist','engager')),
  person_id TEXT NOT NULL,
  agent_id TEXT,
  counts TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(counts)),
  deletion_requests TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(deletion_requests)),
  at INTEGER NOT NULL
);
CREATE INDEX stump_erasures_at ON stump_erasures(at);
