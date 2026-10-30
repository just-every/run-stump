-- The company's AI provider, chosen in Settings · Connections (stump.setup.ai,
-- STUMP-DRAFT-006): an OpenAI-compatible address, the model and the key, sealed
-- with the installation key and never answered back. One row: the company has
-- one provider. An archive leaves the key behind; a restored provider waits for
-- an admin to enter it again.
CREATE TABLE stump_ai_provider (
  id TEXT PRIMARY KEY CHECK(id = 'company'),
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key TEXT,
  key_hint TEXT,
  set_by TEXT NOT NULL,
  set_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
