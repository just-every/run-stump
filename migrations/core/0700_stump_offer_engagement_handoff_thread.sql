-- Each offer names its own engagement: the network's id for the post the person
-- engaged with, beside its URL (post_url), so one person's two engagements read as
-- two offers a person can tell apart (STUMP-STACK-002.1). An annotation offer
-- carries its ledger entry's network id.
ALTER TABLE stump_stack_offers ADD COLUMN network_id TEXT;
UPDATE stump_stack_offers SET network_id = (SELECT i.network_id FROM stump_inbox_items i WHERE i.offer_id = stump_stack_offers.id ORDER BY i.received_at, i.id LIMIT 1)
  WHERE kind = 'engager';
UPDATE stump_stack_offers SET network_id = (SELECT l.network_id FROM stump_ledger l WHERE l.id = stump_stack_offers.ledger_id)
  WHERE kind = 'annotation';

-- A hand-off's draft is aimed at the thread the hand-off names, so the venue's
-- rules read the draft inside its promotion thread (D-3, STUMP-VENUE-002.3).
-- Drafts written before the item carried it take it from their hand-off; the
-- scheduled tick then reads them against the venue's rules again.
UPDATE stump_items SET options = json_set(options, '$.thread_url', (SELECT h.thread_url FROM stump_handoffs h WHERE h.item_id = stump_items.id AND h.thread_url IS NOT NULL LIMIT 1))
  WHERE id IN (SELECT item_id FROM stump_handoffs WHERE item_id IS NOT NULL AND thread_url IS NOT NULL);
