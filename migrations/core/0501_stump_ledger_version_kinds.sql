-- What a ledger version row is (STUMP-LEDGER-001.3). The recorder's rows (kind NULL) hold
-- an entry's earlier state before an outcome changed it; a 'snapshot' keeps the entry as it
-- stood before a correction when no version holds that state yet; a 'correction' is a
-- person's or agent's corrected version, with the fields it changed.
ALTER TABLE stump_ledger_versions ADD COLUMN kind TEXT CHECK(kind IS NULL OR kind IN ('snapshot','correction'));
