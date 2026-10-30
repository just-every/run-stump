-- Products, claims and voice guides (STUMP-BRAND-001 to -004).
CREATE TABLE stump_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT,
  description TEXT,
  tone TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(tone)),
  names TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(names)),
  competitors TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(competitors)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE stump_claims (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('allowed','banned','comparative')),
  proof TEXT,
  owner_id TEXT NOT NULL,
  review_on TEXT,
  reason TEXT,
  competitor TEXT,
  source_url TEXT,
  source_date TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX stump_claims_product ON stump_claims(product_id);

-- A voice guide belongs to one real person and drafts only their items (D-1).
CREATE TABLE stump_voice_guides (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  samples TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(samples)),
  do_list TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(do_list)),
  dont_list TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(dont_list)),
  state TEXT NOT NULL DEFAULT 'draft',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX stump_voice_guides_person ON stump_voice_guides(person_id);

-- Journalists, publications and podcasts (STUMP-PITCH-001).
CREATE TABLE stump_press_contacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('journalist','publication','podcast')),
  name TEXT NOT NULL,
  beat TEXT,
  publication TEXT,
  topics TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(topics)),
  contact_route TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(contact_route)),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Media attached to items (STUMP-PUBLISH-009 and the media actions).
CREATE TABLE stump_media (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  bytes BLOB NOT NULL,
  alt TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX stump_media_item ON stump_media(item_id);
