-- Settings · Agents saves each answer as the owner gives it (L15). Base takes the
-- company's agent policy only once every kind of action has an answer, so the
-- answers given so far wait here, and agents keep waiting, until the last one;
-- then the whole policy goes to Base and these rows are cleared.
CREATE TABLE stump_agent_policy_answers (
  class TEXT PRIMARY KEY,
  answer TEXT NOT NULL CHECK(answer IN ('autonomous','review','approval','blocked')),
  updated_at INTEGER NOT NULL
);
