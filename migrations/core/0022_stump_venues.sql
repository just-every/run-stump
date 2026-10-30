-- The venue register (STUMP-VENUE-001 to -006). rules holds posting, ai_text,
-- self_promotion, links, disclosure_line and gates, each {value, source_url, read_at, sourced}.
CREATE TABLE stump_venues (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  url_key TEXT,
  platform TEXT,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','join_first','ready','editorial','paid','hold','excluded')),
  priority INTEGER,
  rules TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(rules)),
  shared_limit TEXT CHECK(shared_limit IS NULL OR json_valid(shared_limit)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  excluded TEXT CHECK(excluded IS NULL OR json_valid(excluded)),
  notes TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX stump_venues_url_key ON stump_venues(url_key);

CREATE TABLE stump_venue_products (
  venue_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  PRIMARY KEY (venue_id, product_id)
);

-- Who belongs to a venue, as themselves (STUMP-VENUE-006).
CREATE TABLE stump_venue_members (
  venue_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  joined_on TEXT,
  karma INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (venue_id, person_id)
);

CREATE TABLE stump_venue_applications (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','refused')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
