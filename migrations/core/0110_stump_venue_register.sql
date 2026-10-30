-- The venue register's own fields (STUMP-VENUE-001), each product's fit, the
-- register's history, membership and applications (STUMP-VENUE-006), and what
-- the venue-list import wrote (STUMP-VENUE-004).

-- What a person needs to show up well: readers, why it matters, what readers
-- get, how to post (thread, channel, flair, day, template), requirements, and
-- the fields a venue's kind needs (details). JSON columns hold objects.
ALTER TABLE stump_venues ADD COLUMN details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details));
ALTER TABLE stump_venues ADD COLUMN audience TEXT;
ALTER TABLE stump_venues ADD COLUMN why TEXT;
ALTER TABLE stump_venues ADD COLUMN reader_value TEXT;
ALTER TABLE stump_venues ADD COLUMN how_to_post TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(how_to_post));
ALTER TABLE stump_venues ADD COLUMN requirements TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(requirements));
ALTER TABLE stump_venues ADD COLUMN reception TEXT;
ALTER TABLE stump_venues ADD COLUMN archived_at INTEGER;
ALTER TABLE stump_venues ADD COLUMN archived_by TEXT;

-- One venue per place: the canonical URL (or, with no URL, the folded name).
CREATE UNIQUE INDEX stump_venues_one_place ON stump_venues(url_key) WHERE url_key IS NOT NULL;
CREATE INDEX stump_venues_status ON stump_venues(status, archived);

-- A product's fit at a shared venue, 0 to 100, as a person or the import set it.
ALTER TABLE stump_venue_products ADD COLUMN fit INTEGER CHECK(fit IS NULL OR (fit BETWEEN 0 AND 100));
CREATE INDEX stump_venue_products_product ON stump_venue_products(product_id);

-- Every change to a venue, with the person and the agent that made it.
CREATE TABLE stump_venue_history (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  action TEXT NOT NULL,
  person_id TEXT,
  agent_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail)),
  at INTEGER NOT NULL
);
CREATE INDEX stump_venue_history_venue ON stump_venue_history(venue_id, at);

-- A handle belongs to one person at a venue (STUMP-VENUE-006.4).
CREATE UNIQUE INDEX stump_venue_members_handle ON stump_venue_members(venue_id, handle COLLATE NOCASE);

-- Join applications move applied -> approved (or refused). No application rows
-- exist before this migration, so the table is rebuilt with those states.
DROP TABLE stump_venue_applications;
CREATE TABLE stump_venue_applications (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'applied' CHECK(state IN ('applied','approved','refused')),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  decided_by TEXT,
  decided_at INTEGER
);
CREATE UNIQUE INDEX stump_venue_applications_open ON stump_venue_applications(venue_id, person_id) WHERE state = 'applied';

-- What the venue-list import wrote, per native row: the kit's applied revision,
-- the exact value it wrote, and the native revision right after, so any later
-- native edit reads as an edit (kept on Undo, named on a rerun).
CREATE TABLE stump_venue_imports (
  venue_id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL UNIQUE,
  namespace TEXT NOT NULL,
  kit_revision TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  native_revision INTEGER NOT NULL
);
CREATE TABLE stump_product_imports (
  product_id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL UNIQUE,
  namespace TEXT NOT NULL,
  kit_revision TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  native_revision INTEGER NOT NULL,
  native_updated_at INTEGER NOT NULL
);
CREATE TABLE stump_item_imports (
  item_id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL UNIQUE,
  namespace TEXT NOT NULL,
  kit_revision TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  native_revision INTEGER NOT NULL,
  native_updated_at INTEGER NOT NULL
);

-- The counts a venue-list plan shows (venues, entries, excluded), by upload.
-- Counts only; no row content.
CREATE TABLE stump_import_summaries (
  namespace TEXT NOT NULL,
  bundle_sha256 TEXT NOT NULL,
  summary TEXT NOT NULL CHECK(json_valid(summary)),
  PRIMARY KEY (namespace, bundle_sha256)
);
