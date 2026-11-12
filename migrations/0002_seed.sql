-- Starting content: James's projects, their links, the notes he's given so far, and the uptime checks.
-- Edit anything from the app afterwards; this file only runs once.

INSERT INTO projects (id, name, initials, color, ink, type, status, description, hosting, sort, created_at, updated_at) VALUES
  ('tc',   'Tournament Central', 'TC',  '#2563EB', '#FFFFFF', 'Web application',        'live',     'Bowling tournament registration, built to replace tournamentbowl.com.', 'Railway',    1, 1762956000000, 1762956000000),
  ('bw',   'BracketWorks',       'BW',  '#C2410C', '#FFFFFF', 'Web application',        'live',     'Bowling tournament management without the spreadsheet chaos.',          'Railway',    2, 1762956000000, 1762956000000),
  ('st',   'SpareTime',          'ST',  '#0F766E', '#FFFFFF', 'Shared calendar app',    'live',     'One color-coded calendar for two people, with reminders that ping each other.', 'Cloudflare', 3, 1762956000000, 1762956000000),
  ('usbc', 'Ada County USBC',    'AC',  '#4F46E5', '#FFFFFF', 'Website + member portal','progress', 'Association website and member portal on Cloudflare Workers + D1.',   'Cloudflare', 4, 1762956000000, 1762956000000),
  ('pg',   'PayGauge',           'PG',  '#15803D', '#FFFFFF', 'Mobile application',     'progress', 'A focused payment and bill tracker. See what''s left.',                '',           5, 1762956000000, 1762956000000),
  ('mz',   'MAZZARI No. 1',      'M1',  '#D97706', '#09090B', 'Experiment',             'progress', 'Split-flap style board for weather, time, and sports.',               'Cloudflare', 6, 1762956000000, 1762956000000),
  ('208',  '208 Lanes',          '208', '#E11D48', '#FFFFFF', 'Bowling center concept', 'planned',  'A modern-industrial, 40-lane center built for big tournaments that still works for casual bowlers.', '', 7, 1762956000000, 1762956000000);

INSERT INTO links (project_id, label, url, sort) VALUES
  ('tc',   'Site',       'https://tournamentcentral.app', 1),
  ('tc',   'Railway',    'https://railway.com/dashboard', 2),
  ('bw',   'Site',       'https://bracketworks.app', 1),
  ('bw',   'GitHub',     'https://github.com/Mazzagotte/BracketWorks', 2),
  ('bw',   'Railway',    'https://railway.com/dashboard', 3),
  ('st',   'Site',       'https://sparetime.mazzagotte.dev', 1),
  ('st',   'GitHub',     'https://github.com/Mazzagotte/SpareTime', 2),
  ('st',   'Cloudflare', 'https://dash.cloudflare.com', 3),
  ('usbc', 'Review site','https://review-adacountyusbc.org', 1),
  ('usbc', 'GitHub',     'https://github.com/Mazzagotte/Ada-County-USBC-Website', 2),
  ('usbc', 'Cloudflare', 'https://dash.cloudflare.com', 3),
  ('pg',   'GitHub',     'https://github.com/Mazzagotte/PayGauge', 1),
  ('mz',   'Display',    'https://splitflap.mazzagotte.dev', 1),
  ('mz',   'GitHub',     'https://github.com/Mazzagotte/mazzari', 2);

-- 1762887600000 = Nov 11, 2026 · 1762956000000 = Nov 12, 2026 (UTC midnight)
INSERT INTO notes (project_id, kind, text, pinned, created_at, updated_at) VALUES
  ('tc',   'rule',  'Organizers set up squads before divisions, because divisions need squads.', 1, 1762887600000, 1762887600000),
  ('tc',   'rule',  'Organizers need multiple squads for the same tournament across multiple days.', 0, 1762887600000, 1762887600000),
  ('tc',   'todo',  'Wire the most common bowling tournament types into the program.', 0, 1762887600000, 1762887600000),
  ('tc',   'idea',  'Daily update on new sign-ups, newly created tournaments, and site problems.', 0, 1762887600000, 1762887600000),
  ('tc',   'rule',  'Organizers pay $5 per tournament. No refunds if they cancel; edits are free; we absorb the Stripe fee.', 1, 1762956000000, 1762956000000),
  ('bw',   'infra', 'Shares the account system with Tournament Central. Both are hosted on Railway.', 0, 1762887600000, 1762887600000),
  ('st',   'todo',  'Version 2: multi-day events, yearly repeats, and search.', 0, 1762956000000, 1762956000000),
  ('st',   'rule',  'Keep it out of Google and search results. It stays a calendar — nothing more.', 0, 1762956000000, 1762956000000),
  ('usbc', 'infra', 'Deploy runs D1 migrations first, then deploys — the fix for the portal login outage.', 1, 1762887600000, 1762887600000),
  ('208',  'note',  '40 lanes. Reclaimed wood as accents only, never on the lanes. Rubber flooring upstairs.', 0, 1762887600000, 1762887600000),
  ('208',  'todo',  'Pick a name that fits the Treasure Valley — 208 Lanes isn''t final.', 0, 1762887600000, 1762887600000);

INSERT INTO events (project_id, source, level, text, created_at) VALUES
  (NULL, 'hub', 'good', 'Hub set up with 7 projects', 1762956000000);

-- Uptime checks. The Backend check stays off until it has a /health route.
INSERT INTO checks (project_id, name, url, expect_status, expect_text, enabled, sort) VALUES
  ('tc',   'Homepage',  'https://tournamentcentral.app/', NULL, NULL, 1, 1),
  ('bw',   'Homepage',  'https://bracketworks.app/', NULL, NULL, 1, 2),
  ('bw',   'Backend health', 'https://bracketworks-production.up.railway.app/health', 200, NULL, 0, 3),
  ('st',   'App',       'https://sparetime.mazzagotte.dev/', NULL, NULL, 1, 4),
  ('usbc', 'Homepage',  'https://review-adacountyusbc.org/', NULL, NULL, 1, 5),
  ('mz',   'Display health', 'https://splitflap.mazzagotte.dev/api/health', 200, 'splitflap-smart', 1, 6);
