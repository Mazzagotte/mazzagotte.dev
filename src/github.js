// Recent commits and build status for a project's GitHub repo, cached for 10 minutes.
// Public repos work without a key; private ones need GITHUB_TOKEN (read-only) set on the Worker.
const TTL = 10 * 60_000;

// Accepts a repo link, or a folder in a monorepo: github.com/owner/repo/tree/main/apps/web
// A "#also=apps/api,packages" ending adds shared folders whose commits count too.
export const repoFromUrl = (u) => {
  const m = String(u || '').match(/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/[^/#?]+\/([^#?]+?))?\/?(?:#also=([^#?]+))?$/i);
  if (!m) return null;
  return { repo: `${m[1]}/${m[2]}`, path: m[3] || '', also: m[4] ? decodeURIComponent(m[4]).split(',').map((x) => x.trim()).filter(Boolean) : [] };
};
const keyOf = (r) => r.repo + (r.path ? ':' + r.path : '') + (r.also.length ? '+' + r.also.join(',') : '');

async function gh(env, path) {
  const headers = { 'user-agent': 'mazzagotte-hub', accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const res = await fetch('https://api.github.com' + path, { headers });
  if (res.status === 404) throw Object.assign(new Error(env.GITHUB_TOKEN ? 'Repo not found, or the GitHub key can’t see it' : 'Private repo — add a GitHub key to see it'), { code: 'private' });
  if (res.status === 403 || res.status === 429) throw Object.assign(new Error('GitHub rate limit reached — add a GitHub key for more'), { code: 'rate' });
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  return res.json();
}

function buildState(checks, status) {
  const runs = (checks && checks.check_runs) || [];
  const states = [...runs.map((r) => (r.status !== 'completed' ? 'pending' : ['success', 'neutral', 'skipped'].includes(r.conclusion) ? 'success' : 'failure')),
    ...((status && status.statuses) || []).map((s) => (s.state === 'pending' ? 'pending' : s.state === 'success' ? 'success' : 'failure'))];
  if (!states.length) return null;
  if (states.includes('failure')) return 'failure';
  if (states.includes('pending')) return 'pending';
  return 'success';
}

export async function repoFeed(env, target, { fresh = false } = {}) {
  const { repo, path, also } = target;
  const key = keyOf(target);
  const cached = await env.DB.prepare('SELECT * FROM gh_cache WHERE repo = ?').bind(key).first();
  if (cached && !fresh && Date.now() - cached.fetched_at < TTL) return { ...JSON.parse(cached.body), cached: true };
  try {
    // In a monorepo, collect commits for the app's folder plus any shared folders, newest first.
    const paths = path ? [path, ...also] : [''];
    const [info, ...lists] = await Promise.all([gh(env, `/repos/${repo}`), ...paths.map((p) => gh(env, `/repos/${repo}/commits?per_page=8${p ? '&path=' + encodeURIComponent(p) : ''}`))]);
    const seen = new Map();
    lists.forEach((list, i) => list.forEach((c) => { if (!seen.has(c.sha)) seen.set(c.sha, { ...c, shared: i > 0 }); }));
    const when = (c) => Date.parse((c.commit.author && c.commit.author.date) || c.commit.committer.date);
    const commits = [...seen.values()].sort((a, b) => when(b) - when(a)).slice(0, 8);
    const head = commits[0];
    let build = null;
    if (head) {
      const [checks, status] = await Promise.all([
        gh(env, `/repos/${repo}/commits/${head.sha}/check-runs?per_page=20`).catch(() => null),
        gh(env, `/repos/${repo}/commits/${head.sha}/status`).catch(() => null),
      ]);
      build = buildState(checks, status);
    }
    const body = {
      repo, path, url: path ? `${info.html_url}/tree/${info.default_branch}/${path}` : info.html_url, private: info.private, branch: info.default_branch, pushed_at: info.pushed_at, open_issues: info.open_issues_count,
      build,
      commits: commits.map((c) => ({
        sha: c.sha.slice(0, 7), url: c.html_url, shared: !!c.shared,
        message: String(c.commit.message || '').split('\n')[0].slice(0, 160),
        author: (c.author && c.author.login) || (c.commit.author && c.commit.author.name) || '',
        at: Date.parse((c.commit.author && c.commit.author.date) || c.commit.committer.date),
      })),
    };
    await env.DB.prepare('INSERT INTO gh_cache (repo, body, fetched_at) VALUES (?, ?, ?) ON CONFLICT(repo) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at')
      .bind(key, JSON.stringify(body), Date.now()).run();
    return body;
  } catch (e) {
    // Fall back to the last good copy if GitHub is unhappy.
    if (cached) return { ...JSON.parse(cached.body), cached: true, stale: e.message };
    return { repo, path, url: `https://github.com/${repo}`, error: e.message, code: e.code || 'error', has_key: !!env.GITHUB_TOKEN };
  }
}
