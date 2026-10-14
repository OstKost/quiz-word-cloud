CREATE TABLE rooms (code TEXT PRIMARY KEY, secret TEXT NOT NULL, question TEXT NOT NULL, max_answers INTEGER NOT NULL, duration INTEGER NOT NULL, filter INTEGER NOT NULL, status TEXT NOT NULL, deadline INTEGER, remaining INTEGER NOT NULL, round INTEGER NOT NULL DEFAULT 1);
--> statement-breakpoint
CREATE TABLE answers (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL REFERENCES rooms(code), round INTEGER NOT NULL, participant TEXT NOT NULL, word TEXT NOT NULL, created INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX answers_room ON answers(room,round,participant);
--> statement-breakpoint
CREATE TABLE hidden (room TEXT NOT NULL, round INTEGER NOT NULL, word TEXT NOT NULL, PRIMARY KEY(room,round,word));
