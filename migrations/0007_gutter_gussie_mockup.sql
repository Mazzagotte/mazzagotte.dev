-- Gutter Gussie is a static mockup for now (the working form and admin wait on the membership-backend branch).
UPDATE projects SET type = 'Club website (mockup)',
  description = 'Mockup of the Idaho Gutter Gussie Club website. The membership form is preview-only for now.'
WHERE id = 'gg';

DELETE FROM links WHERE project_id = 'gg' AND url = 'https://guttergussie.mazzagotte.dev/admin';

DELETE FROM notes WHERE project_id = 'gg' AND text IN (
  'Worker gutter-gussie + D1 gutter-gussie + private R2 bucket gutter-gussie-proofs for recap/standing sheets. Admin at /admin behind Cloudflare Access.',
  'Finish setup: import the repo in Cloudflare, Turnstile widget, Access app for /admin, variables (see the repo README). Then turn on the Gutter Gussie check under Monitoring.'
);
INSERT INTO notes (project_id, kind, text, pinned, created_at, updated_at) VALUES
  ('gg', 'infra', 'Static mockup on Cloudflare (Worker gutter-gussie, assets only). The working form + club admin is on the membership-backend branch; D1 gutter-gussie and R2 gutter-gussie-proofs are set aside for it.', 1, 1794528000000, 1794528000000),
  ('gg', 'todo',  'Import the repo in Cloudflare (no build command, deploy command npx wrangler deploy), then turn on the Gutter Gussie check under Monitoring.', 1, 1794528000000, 1794528000000);

UPDATE checks SET name = 'Homepage', url = 'https://guttergussie.mazzagotte.dev/', expect_status = 200, expect_text = 'Gutter Gussie'
WHERE url = 'https://guttergussie.mazzagotte.dev/api/health';
