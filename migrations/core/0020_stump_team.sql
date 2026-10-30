-- Stump's people. id is the Base operator id (oa_operators.id); the role and
-- connection are Stump's. An invitation creates the person as 'invited', holding
-- nothing (D-1); they become 'active' once that operator has signed in since the
-- invitation, which is the moment the invitation is accepted.
CREATE TABLE stump_people (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','contributor','poster','viewer')),
  connection TEXT CHECK(connection IS NULL OR connection IN ('founder','employee','contractor','investor','advisor','friend','family')),
  disclosure_lines TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(disclosure_lines)),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('invited','active','removed')),
  invited_at INTEGER,
  invited_by TEXT,
  invited_by_agent TEXT,
  joined_at INTEGER CHECK(status <> 'active' OR joined_at IS NOT NULL),
  removed_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 1,
  CHECK(status <> 'invited' OR (invited_at IS NOT NULL AND role <> 'owner'))
);
-- Exactly one active owner at a time.
CREATE UNIQUE INDEX stump_people_one_owner ON stump_people(role) WHERE role = 'owner' AND status = 'active';
CREATE INDEX stump_people_invited ON stump_people(status) WHERE status = 'invited';

-- Every team change, with the person and the agent that made it.
CREATE TABLE stump_team_history (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  person_id TEXT,
  email TEXT,
  actor_id TEXT NOT NULL,
  agent_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail)),
  at INTEGER NOT NULL
);
CREATE INDEX stump_team_history_at ON stump_team_history(at);

-- Agent credentials a person issues for their own agent (the door's localCredentials).
CREATE TABLE stump_agent_credentials (
  client_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  person_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX stump_agent_credentials_person ON stump_agent_credentials(person_id);
