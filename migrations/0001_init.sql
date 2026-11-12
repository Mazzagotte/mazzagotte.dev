-- mazzagotte.dev hub: projects, notes, monitoring, money.
-- All times are UTC epoch milliseconds unless a column says otherwise.

CREATE TABLE config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,               -- short slug, e.g. 'tc'
  name        TEXT NOT NULL,
  initials    TEXT NOT NULL,
  color       TEXT NOT NULL,                  -- tile + stripe color, '#RRGGBB'
  ink         TEXT NOT NULL DEFAULT '#FFFFFF',-- text color on the tile
  type        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'progress' CHECK (status IN ('live', 'progress', 'planned')),
  description TEXT NOT NULL DEFAULT '',
  hosting     TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE links (
  id         INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  url        TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX links_project ON links (project_id);

CREATE TABLE notes (
  id         INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'todo', 'idea', 'rule', 'infra')),
  text       TEXT NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0,
  done       INTEGER NOT NULL DEFAULT 0,       -- only meaningful for kind = 'todo'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX notes_project ON notes (project_id, created_at);
CREATE INDEX notes_todo ON notes (kind, done);

-- Everything that happened, newest first on the dashboard: notes, deploys, outages, payments.
CREATE TABLE events (
  id         INTEGER PRIMARY KEY,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  source     TEXT NOT NULL,                    -- hub | check | railway | deploy | money
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'good', 'warn', 'bad')),
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX events_time ON events (created_at);

-- ---------- monitoring ----------
CREATE TABLE checks (
  id            INTEGER PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  expect_status INTEGER,                       -- NULL = any 2xx/3xx counts as up
  expect_text   TEXT,                          -- optional text that must appear in the body
  enabled       INTEGER NOT NULL DEFAULT 1,
  sort          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE check_results (
  id       INTEGER PRIMARY KEY,
  check_id INTEGER NOT NULL REFERENCES checks (id) ON DELETE CASCADE,
  ok       INTEGER NOT NULL,
  status   INTEGER,
  ms       INTEGER,
  error    TEXT,
  at       INTEGER NOT NULL
);
CREATE INDEX check_results_time ON check_results (check_id, at);

CREATE TABLE check_state (
  check_id    INTEGER PRIMARY KEY REFERENCES checks (id) ON DELETE CASCADE,
  fails       INTEGER NOT NULL DEFAULT 0,      -- failures in a row
  last_at     INTEGER,
  last_ok     INTEGER,
  last_ms     INTEGER,
  last_status INTEGER,
  last_error  TEXT,
  incident_id INTEGER
);

CREATE TABLE incidents (
  id          INTEGER PRIMARY KEY,
  project_id  TEXT REFERENCES projects (id) ON DELETE SET NULL,
  check_id    INTEGER REFERENCES checks (id) ON DELETE SET NULL,
  source      TEXT NOT NULL,                   -- check | railway | deploy | manual
  title       TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  started_at  INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX incidents_open ON incidents (resolved_at, started_at);

-- ---------- money ----------
CREATE TABLE ledger (
  id           INTEGER PRIMARY KEY,
  project_id   TEXT REFERENCES projects (id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('income', 'cost', 'fee', 'refund')),
  source       TEXT NOT NULL DEFAULT 'manual', -- manual | stripe | railway | cloudflare
  description  TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  occurred_on  TEXT NOT NULL,                  -- YYYY-MM-DD
  external_id  TEXT UNIQUE,                    -- Stripe / invoice id, so a repeated webhook is saved once
  created_at   INTEGER NOT NULL
);
CREATE INDEX ledger_date ON ledger (occurred_on);

CREATE TABLE renewals (
  id          INTEGER PRIMARY KEY,
  project_id  TEXT REFERENCES projects (id) ON DELETE SET NULL,
  domain      TEXT NOT NULL,
  renews_on   TEXT NOT NULL,                   -- YYYY-MM-DD
  price_cents INTEGER NOT NULL DEFAULT 0,
  auto        INTEGER NOT NULL DEFAULT 1
);

-- ---------- push ----------
CREATE TABLE push_subs (
  id         INTEGER PRIMARY KEY,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Once-only markers for scheduled jobs (daily summary, renewal warnings).
CREATE TABLE sent (
  key TEXT PRIMARY KEY
);
