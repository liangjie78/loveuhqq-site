CREATE TABLE IF NOT EXISTS memory_members (
  id TEXT PRIMARY KEY CHECK(id IN ('one','two')), name TEXT NOT NULL, password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_sessions (
  token_hash TEXT PRIMARY KEY, parent_hash TEXT NOT NULL, member_id TEXT NOT NULL REFERENCES memory_members(id), expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_sessions_parent ON memory_sessions(parent_hash);
CREATE TABLE IF NOT EXISTS memory_stories (
  id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version > 0), title TEXT NOT NULL, date TEXT NOT NULL,
  text TEXT NOT NULL, photo_ids TEXT NOT NULL, wish_ids TEXT NOT NULL, layout TEXT NOT NULL,
  reveal_together INTEGER NOT NULL, opened_at INTEGER
);
CREATE TABLE IF NOT EXISTS memory_parts (
  story_id TEXT NOT NULL REFERENCES memory_stories(id), member_id TEXT NOT NULL REFERENCES memory_members(id),
  version INTEGER NOT NULL CHECK(version > 0), text TEXT NOT NULL, reply TEXT NOT NULL, submitted INTEGER NOT NULL, audio_ids TEXT NOT NULL,
  PRIMARY KEY(story_id,member_id)
);
CREATE TABLE IF NOT EXISTS memory_letters (
  id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version > 0), sender_id TEXT NOT NULL REFERENCES memory_members(id),
  recipient_id TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, open_date TEXT NOT NULL, pair_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','sealed')), sealed_at INTEGER, audio_ids TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_letters_pair ON memory_letters(pair_key,status);
CREATE TABLE IF NOT EXISTS memory_audio (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES memory_members(id), story_id TEXT, letter_id TEXT,
  mime TEXT NOT NULL, bytes INTEGER NOT NULL, duration REAL NOT NULL,
  CHECK((story_id IS NOT NULL) != (letter_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS memory_places (
  id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version > 0), name TEXT NOT NULL, lat REAL NOT NULL,
  lng REAL NOT NULL, year INTEGER NOT NULL, story_ids TEXT NOT NULL, wish_ids TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_wish_plans (
  id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version > 0), planned_date TEXT, story_id TEXT
);
