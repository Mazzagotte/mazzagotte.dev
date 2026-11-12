-- Recurring bills (hosting, workspace, subscriptions). Each one posts a cost to the ledger when it comes due.
CREATE TABLE recurring (
  id           INTEGER PRIMARY KEY,
  project_id   TEXT REFERENCES projects (id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  cadence      TEXT NOT NULL DEFAULT 'monthly' CHECK (cadence IN ('monthly', 'yearly')),
  next_on      TEXT NOT NULL,                  -- YYYY-MM-DD, next date it will be charged
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);
CREATE INDEX recurring_next ON recurring (active, next_on);
