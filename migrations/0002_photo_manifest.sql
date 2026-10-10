CREATE TABLE IF NOT EXISTS photo_manifest (id INTEGER PRIMARY KEY CHECK (id = 1), manifest TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 0));
