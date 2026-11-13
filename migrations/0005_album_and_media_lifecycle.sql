CREATE TABLE album_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
);
CREATE TABLE album_photos (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  date TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  featured_rank INTEGER,
  removed_at INTEGER
);
CREATE INDEX album_photos_removed ON album_photos(removed_at);
CREATE TABLE album_uploads (object_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);

CREATE TRIGGER album_photo_insert AFTER INSERT ON album_photos
BEGIN UPDATE album_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER album_photo_update AFTER UPDATE ON album_photos
BEGIN UPDATE album_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER album_photo_delete AFTER DELETE ON album_photos WHEN OLD.removed_at IS NULL
BEGIN UPDATE album_state SET revision = revision + 1 WHERE id = 1; END;

CREATE TABLE memory_change (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);
INSERT INTO memory_change (id, revision) VALUES (1, 0);

CREATE TRIGGER memory_story_added AFTER INSERT ON memory_stories
BEGIN UPDATE memory_change SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER memory_story_changed AFTER UPDATE ON memory_stories
BEGIN UPDATE memory_change SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER memory_part_added AFTER INSERT ON memory_parts
BEGIN UPDATE memory_change SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER memory_part_changed AFTER UPDATE ON memory_parts
BEGIN UPDATE memory_change SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER memory_letter_added AFTER INSERT ON memory_letters
BEGIN UPDATE memory_change SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER memory_letter_changed AFTER UPDATE ON memory_letters
BEGIN UPDATE memory_change SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER memory_place_added AFTER INSERT ON memory_places
BEGIN UPDATE memory_change SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER memory_place_changed AFTER UPDATE ON memory_places
BEGIN UPDATE memory_change SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER memory_plan_added AFTER INSERT ON memory_wish_plans
BEGIN UPDATE memory_change SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER memory_plan_changed AFTER UPDATE ON memory_wish_plans
BEGIN UPDATE memory_change SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER memory_wish_added AFTER INSERT ON notebook_entries WHEN NEW.kind = 'wish'
BEGIN UPDATE memory_change SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER memory_wish_changed AFTER UPDATE ON notebook_entries WHEN NEW.kind = 'wish'
BEGIN UPDATE memory_change SET revision = revision + 1 WHERE id = 1; END;

ALTER TABLE memory_audio ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_audio ADD COLUMN reclaiming INTEGER NOT NULL DEFAULT 0 CHECK (reclaiming IN (0, 1));
UPDATE memory_audio SET created_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE created_at = 0;
CREATE TRIGGER memory_audio_timestamp AFTER INSERT ON memory_audio WHEN NEW.created_at = 0
BEGIN UPDATE memory_audio SET created_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id; END;
CREATE INDEX memory_audio_cleanup ON memory_audio(reclaiming, created_at);
