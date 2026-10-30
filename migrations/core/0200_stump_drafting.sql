-- Drafting (STUMP-BRAND-001 to -004, STUMP-DRAFT-001 to -010, STUMP-TRUTH-004).
-- The rest of a product's profile: its audience, positioning, URLs and the words it uses and avoids.
ALTER TABLE stump_products ADD COLUMN audience TEXT;
ALTER TABLE stump_products ADD COLUMN positioning TEXT;
ALTER TABLE stump_products ADD COLUMN urls TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(urls));
ALTER TABLE stump_products ADD COLUMN use_words TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(use_words));
ALTER TABLE stump_products ADD COLUMN avoid_words TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(avoid_words));

-- Wordings a person backed with this claim from a draft (stump.drafts.check back); matched like its text.
ALTER TABLE stump_claims ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(aliases));

-- One master text opened as a variant per account (STUMP-DRAFT-010). Variants are stump_items with master_id.
CREATE TABLE stump_masters (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  product_id TEXT,
  text TEXT NOT NULL,
  account_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(account_ids)),
  sources TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(sources)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The company's drafting settings: its own names (for mentions and disclosure) and the near-duplicate window.
CREATE TABLE stump_drafting_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  company_names TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(company_names)),
  duplicate_window_days INTEGER NOT NULL DEFAULT 30 CHECK(duplicate_window_days BETWEEN 1 AND 365),
  updated_by TEXT,
  updated_at INTEGER
);
INSERT INTO stump_drafting_settings(id) VALUES (1);
