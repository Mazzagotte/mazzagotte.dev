-- To-do board: due dates, manual order, when it was finished.
ALTER TABLE notes ADD COLUMN due_on TEXT;        -- YYYY-MM-DD or NULL
ALTER TABLE notes ADD COLUMN sort REAL;          -- manual order on the board (lower = higher up)
ALTER TABLE notes ADD COLUMN done_at INTEGER;
CREATE INDEX notes_todo_due ON notes (kind, done, due_on);

-- GitHub feed cache, so project pages stay fast and we stay under GitHub's rate limits.
CREATE TABLE gh_cache (
  repo       TEXT PRIMARY KEY,                   -- owner/name
  body       TEXT NOT NULL,                      -- JSON
  fetched_at INTEGER NOT NULL
);
