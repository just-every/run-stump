-- What an inbox post's author shows publicly on their own profile (STUMP-STACK-002.3):
-- the bio as the network returned it with the post, and an email address only when
-- that profile shows one. Never guessed or looked up elsewhere.
ALTER TABLE stump_inbox_items ADD COLUMN author_bio TEXT;
ALTER TABLE stump_inbox_items ADD COLUMN author_public_email TEXT;
