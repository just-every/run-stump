-- Handles as each network names them (an atproto handle is the bare domain,
-- an X username has no '@'); Stump adds the '@' only on screen.
UPDATE stump_accounts SET handle=substr(handle,2) WHERE handle LIKE '@%' AND network<>'linkedin';

-- X's Automated label (STUMP-PUBLISH-004): whether the account's bio names its
-- operator, recorded as that fact or together with the bio's text.
ALTER TABLE stump_accounts ADD COLUMN operator_named INTEGER NOT NULL DEFAULT 0 CHECK(operator_named IN (0,1));
UPDATE stump_accounts SET operator_named=1 WHERE operator_bio IS NOT NULL AND trim(operator_bio)<>'';

-- What finishing a consent answered, for the page the network sends the person back to.
ALTER TABLE stump_connections ADD COLUMN outcome TEXT CHECK(outcome IS NULL OR json_valid(outcome));
