-- Idaho Gutter Gussie Club website (guttergussie.mazzagotte.dev): project, links, notes and its uptime check.
-- 1794528000000 = Nov 13, 2026 (UTC midnight)
INSERT OR IGNORE INTO projects (id, name, initials, color, ink, type, status, description, hosting, sort, created_at, updated_at)
VALUES ('gg', 'Idaho Gutter Gussie Club', 'GG', '#8100A5', '#FFFFFF', 'Club website', 'progress',
        'Club website with an online membership application and a club admin for reviewing applications.',
        'Cloudflare', (SELECT COALESCE(MAX(sort), 0) + 1 FROM projects), 1794528000000, 1794528000000);

INSERT INTO links (project_id, label, url, sort)
SELECT 'gg', label, url, sort FROM (
  SELECT 'Site' AS label, 'https://guttergussie.mazzagotte.dev' AS url, 1 AS sort
  UNION ALL SELECT 'Club admin', 'https://guttergussie.mazzagotte.dev/admin', 2
  UNION ALL SELECT 'GitHub', 'https://github.com/Mazzagotte/gutter-gussie', 3
  UNION ALL SELECT 'Cloudflare', 'https://dash.cloudflare.com', 4
) AS l
WHERE NOT EXISTS (SELECT 1 FROM links WHERE project_id = 'gg' AND links.url = l.url);

INSERT INTO notes (project_id, kind, text, pinned, created_at, updated_at) VALUES
  ('gg', 'infra', 'Worker gutter-gussie + D1 gutter-gussie + private R2 bucket gutter-gussie-proofs for recap/standing sheets. Admin at /admin behind Cloudflare Access.', 1, 1794528000000, 1794528000000),
  ('gg', 'rule',  'Membership: 225 scratch game or 550 scratch series in a sanctioned Idaho league or tournament, apply within 365 days, $20 lifetime. No-tap doesn''t qualify.', 0, 1794528000000, 1794528000000),
  ('gg', 'todo',  'Finish setup: import the repo in Cloudflare, Turnstile widget, Access app for /admin, variables (see the repo README). Then turn on the Gutter Gussie check under Monitoring.', 1, 1794528000000, 1794528000000),
  ('gg', 'todo',  'Confirm permission for the archival photos before promoting the site.', 0, 1794528000000, 1794528000000);

-- Off until the site is deployed, so it doesn't page you in the meantime. Turn on under Monitoring → Checks.
INSERT INTO checks (project_id, name, url, expect_status, expect_text, enabled, sort)
SELECT 'gg', 'Site health', 'https://guttergussie.mazzagotte.dev/api/health', 200, 'gutter-gussie ok', 0,
       (SELECT COALESCE(MAX(sort), 0) + 1 FROM checks)
WHERE NOT EXISTS (SELECT 1 FROM checks WHERE url = 'https://guttergussie.mazzagotte.dev/api/health');

INSERT INTO events (project_id, source, level, text, created_at)
VALUES ('gg', 'hub', 'info', 'Added Idaho Gutter Gussie Club', 1794528000000);
