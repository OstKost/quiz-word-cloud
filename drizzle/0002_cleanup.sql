ALTER TABLE rooms ADD COLUMN last_accessed INTEGER;
--> statement-breakpoint
UPDATE rooms SET last_accessed=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE last_accessed IS NULL;
--> statement-breakpoint
CREATE INDEX rooms_last_accessed ON rooms(last_accessed);
--> statement-breakpoint
CREATE TABLE cleanup_state (id INTEGER PRIMARY KEY CHECK(id=1), last_success INTEGER NOT NULL);
