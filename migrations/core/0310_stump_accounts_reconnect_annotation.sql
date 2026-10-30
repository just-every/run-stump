-- Why an account waits for its owner to reconnect (STUMP-CONNECT-001.4): the network
-- refused its credentials as revoked or expired. The contract's state word is
-- 'expired' for both; the reason says which.
ALTER TABLE stump_accounts ADD COLUMN state_reason TEXT;
UPDATE stump_accounts SET state='expired', state_reason=COALESCE(state_reason, 'Its access was revoked at the network.') WHERE state='revoked';

-- What Vane answered for the post's annotation (STUMP-STACK-004): sent, failed with
-- its error, or waiting for Vane to be connected. A failure never changes the post.
ALTER TABLE stump_ledger ADD COLUMN annotation TEXT CHECK(annotation IS NULL OR json_valid(annotation));
