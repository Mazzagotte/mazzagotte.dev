-- Uptime rollups. The monitoring pages used to count raw check_results rows on every load
-- (a full table scan, ~93k rows and growing). Now each check run adds 1 to an hourly and a daily
-- counter, and the pages read those instead: a few hundred rows per load.
--
-- check_hourly feeds the 24-hour sparklines (kept 2 days).
-- check_daily feeds the 90-day strip and the uptime percentages (kept 95 days).
-- Days are UTC, the same as the old query.
-- ms_sum / ms_n = average response time (ms_n counts results that had a time).

CREATE TABLE check_hourly (
  check_id INTEGER NOT NULL REFERENCES checks (id) ON DELETE CASCADE,
  hour     INTEGER NOT NULL,                 -- unix ms / 3,600,000
  total    INTEGER NOT NULL DEFAULT 0,
  ok       INTEGER NOT NULL DEFAULT 0,
  ms_sum   INTEGER NOT NULL DEFAULT 0,
  ms_n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (check_id, hour)
);

CREATE TABLE check_daily (
  check_id INTEGER NOT NULL REFERENCES checks (id) ON DELETE CASCADE,
  day      TEXT NOT NULL,                    -- YYYY-MM-DD (UTC)
  total    INTEGER NOT NULL DEFAULT 0,
  ok       INTEGER NOT NULL DEFAULT 0,
  ms_sum   INTEGER NOT NULL DEFAULT 0,
  ms_n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (check_id, day)
);

-- Fill both from the history already saved, so the graphs don't start over.
INSERT INTO check_hourly (check_id, hour, total, ok, ms_sum, ms_n)
  SELECT check_id, at / 3600000, COUNT(*), SUM(ok), COALESCE(SUM(ms), 0), COUNT(ms)
    FROM check_results
   WHERE at >= (CAST(strftime('%s', 'now') AS INTEGER) - 2 * 86400) * 1000
   GROUP BY check_id, at / 3600000;

INSERT INTO check_daily (check_id, day, total, ok, ms_sum, ms_n)
  SELECT check_id, strftime('%Y-%m-%d', at / 1000, 'unixepoch'), COUNT(*), SUM(ok), COALESCE(SUM(ms), 0), COUNT(ms)
    FROM check_results
   GROUP BY check_id, strftime('%Y-%m-%d', at / 1000, 'unixepoch');

-- From now on check_results only keeps failures (for the error text). The passing rows already saved
-- age out in the nightly prune a day's worth at a time, not all at once, so the cleanup stays well
-- under D1's daily write limit. (No new index here for the same reason: indexing 93k rows = 93k writes.)
