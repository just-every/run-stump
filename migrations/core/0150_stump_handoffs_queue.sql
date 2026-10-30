-- The hand-off queue's own fields (STUMP-HANDOFF-001 to -003). Block 0150-0199.
-- route: the hand-off the venue's rules allowed when it was prepared (a draft, or a brief and facts).
-- recommends: the item recommends or endorses the company's products, which for an outside voice means
-- talking points only and the person's attestation before it records (D-8).
ALTER TABLE stump_handoffs ADD COLUMN route TEXT CHECK(route IS NULL OR route IN ('handoff_draft','handoff_brief'));
ALTER TABLE stump_handoffs ADD COLUMN recommends INTEGER NOT NULL DEFAULT 0 CHECK(recommends IN (0,1));
-- How the posted link was confirmed (the network's own read, or the person), when, and when the person attested.
ALTER TABLE stump_handoffs ADD COLUMN confirmation TEXT CHECK(confirmation IS NULL OR confirmation IN ('network','person'));
ALTER TABLE stump_handoffs ADD COLUMN posted_at INTEGER;
ALTER TABLE stump_handoffs ADD COLUMN attested_at INTEGER;

-- The scheduled tick finds what is due, held for review or waiting on a rule.
CREATE INDEX stump_handoffs_due ON stump_handoffs(state, due_at);
-- One ledger entry per hand-off.
CREATE UNIQUE INDEX stump_ledger_handoff ON stump_ledger(handoff_id) WHERE handoff_id IS NOT NULL;
