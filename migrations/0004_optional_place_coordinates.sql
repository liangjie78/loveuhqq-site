-- Wrangler applies each D1 migration atomically. Copy every column before replacing the table.
-- No table has a foreign key referencing memory_places.
CREATE TABLE memory_places_optional (
  id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version > 0), name TEXT NOT NULL, lat REAL,
  lng REAL, year INTEGER NOT NULL, story_ids TEXT NOT NULL, wish_ids TEXT NOT NULL
);
INSERT INTO memory_places_optional (id, version, name, lat, lng, year, story_ids, wish_ids)
SELECT id, version, name, lat, lng, year, story_ids, wish_ids FROM memory_places;
DROP TABLE memory_places;
ALTER TABLE memory_places_optional RENAME TO memory_places;
