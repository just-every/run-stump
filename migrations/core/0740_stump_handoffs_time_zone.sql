-- The time zone a hand-off's due time is set and shown in (STUMP-HANDOFF-001): the zone its creator picked, so the
-- poster and everyone else read the same due day and time. Hand-offs prepared before it hold none and show their
-- due time in each reader's own zone.
ALTER TABLE stump_handoffs ADD COLUMN time_zone TEXT;
