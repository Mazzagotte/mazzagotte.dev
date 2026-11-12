-- Files attached to notes (stored in the private R2 bucket mazzagotte-files).
-- note_id is not a hard foreign key so Undo after deleting a note can re-attach the same files.
CREATE TABLE note_files (
  id         INTEGER PRIMARY KEY,
  note_id    INTEGER,                      -- NULL while the note is deleted (Undo window)
  project_id TEXT NOT NULL,
  key        TEXT NOT NULL UNIQUE,         -- R2 object key
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'application/octet-stream',
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  orphaned_at INTEGER                      -- when its note was deleted; cleaned up after a day
);
CREATE INDEX note_files_note ON note_files (note_id);
