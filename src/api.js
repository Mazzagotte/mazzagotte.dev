// The hub's API. Everything here sits behind Cloudflare Access (see index.js).
import { runChecks } from './checks.js';
import { logEvent } from './events.js';
import { pushAll, vapidKeys } from './push.js';
import {
  COLOR_RE, DATE_RE, HttpError, LEDGER_KINDS, NOTE_KINDS, SLUG_RE, STATUSES,
  addDays, httpUrl, json, need, readJson, str, todayLocal,
} from './util.js';

const tzOf = (env) => env.TIMEZONE || 'America/Denver';

// ---------- shared queries ----------
async function allProjects(env) {
  const { results } = await env.DB.prepare('SELECT * FROM projects WHERE archived = 0 ORDER BY sort, name').all();
  return results;
}

async function linksByProject(env) {
  const { results } = await env.DB.prepare('SELECT * FROM links ORDER BY project_id, sort, id').all();
  const map = {};
  for (const l of results) (map[l.project_id] ||= []).push(l);
  return map;
}

async function latestNotes(env) {
  // Newest non-todo note per project (pinned first is shown on the project page, newest on cards).
  const { results } = await env.DB.prepare(
    `SELECT n.* FROM notes n
      WHERE n.kind != 'todo' AND n.created_at = (SELECT MAX(created_at) FROM notes WHERE project_id = n.project_id AND kind != 'todo')
      GROUP BY n.project_id`
  ).all();
  return Object.fromEntries(results.map((n) => [n.project_id, n]));
}

async function statusRows(env) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.project_id, c.name, c.url, c.enabled, s.last_ok, s.last_ms, s.last_at, s.last_status, s.last_error, s.incident_id
       FROM checks c LEFT JOIN check_state s ON s.check_id = c.id
      ORDER BY c.sort, c.id`
  ).all();
  return results;
}

// Response time for the last 24 hours, one point per hour, for the little sparklines.
async function sparks(env) {
  const hour = 3600_000;
  const end = Math.floor(Date.now() / hour);
  const { results } = await env.DB.prepare(
    'SELECT check_id, at / 3600000 AS h, AVG(ms) AS ms, MIN(ok) AS ok FROM check_results WHERE at >= ? GROUP BY check_id, h'
  ).bind((end - 23) * hour).all();
  const out = {};
  for (const r of results) {
    const i = Math.floor(r.h) - (end - 23);
    if (i < 0 || i > 23) continue;
    (out[r.check_id] ||= Array(24).fill(null))[i] = { ms: r.ms == null ? null : Math.round(r.ms), ok: !!r.ok };
  }
  return out;
}

async function search(env, q) {
  q = String(q || '').trim().slice(0, 80);
  if (q.length < 2) return { notes: [], links: [] };
  const like = '%' + q.replace(/[%_\\]/g, (c) => '\\' + c) + '%';
  const [{ results: notes }, { results: links }] = await Promise.all([
    env.DB.prepare(
      `SELECT n.id, n.kind, n.text, n.project_id, n.created_at, p.name AS project_name, p.color, p.initials, p.ink
         FROM notes n JOIN projects p ON p.id = n.project_id
        WHERE p.archived = 0 AND n.text LIKE ? ESCAPE '\\' ORDER BY n.created_at DESC LIMIT 8`
    ).bind(like).all(),
    env.DB.prepare(
      `SELECT l.id, l.label, l.url, l.project_id, p.name AS project_name, p.color, p.initials, p.ink
         FROM links l JOIN projects p ON p.id = l.project_id
        WHERE p.archived = 0 AND (l.label LIKE ? ESCAPE '\\' OR l.url LIKE ? ESCAPE '\\') ORDER BY l.sort LIMIT 5`
    ).bind(like, like).all(),
  ]);
  return { notes, links };
}

function monthRange(date) {
  const start = date.slice(0, 8) + '01';
  const [y, m] = start.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return [start, addDays(next, -1)];
}

async function moneySummary(env, from, to) {
  const { results } = await env.DB.prepare(
    'SELECT kind, SUM(amount_cents) AS cents FROM ledger WHERE occurred_on BETWEEN ? AND ? GROUP BY kind'
  ).bind(from, to).all();
  const t = { income: 0, cost: 0, fee: 0, refund: 0 };
  for (const r of results) t[r.kind] = r.cents || 0;
  return { income: t.income, costs: t.cost + t.fee + t.refund, net: t.income - t.cost - t.fee - t.refund, ...t };
}

// ---------- dashboard ----------
async function dashboard(env) {
  const tz = tzOf(env);
  const today = todayLocal(tz);
  const [projects, links, latest, rawChecks, spark] = await Promise.all([allProjects(env), linksByProject(env), latestNotes(env), statusRows(env), sparks(env)]);
  const checks = rawChecks.map((c) => ({ ...c, spark: spark[c.id] || [] }));
  const { results: todos } = await env.DB.prepare(
    `SELECT n.*, p.name AS project_name, p.color FROM notes n JOIN projects p ON p.id = n.project_id
      WHERE n.kind = 'todo' AND p.archived = 0 ORDER BY n.done, n.created_at DESC LIMIT 12`
  ).all();
  const { results: events } = await env.DB.prepare(
    `SELECT e.*, p.name AS project_name, p.color FROM events e LEFT JOIN projects p ON p.id = e.project_id
      ORDER BY e.created_at DESC, e.id DESC LIMIT 8`
  ).all();
  const { results: openIncidents } = await env.DB.prepare('SELECT * FROM incidents WHERE resolved_at IS NULL').all();
  const [from, to] = monthRange(today);
  const money = await moneySummary(env, from, to);
  const renewal = await env.DB.prepare('SELECT * FROM renewals WHERE renews_on >= ? ORDER BY renews_on LIMIT 1').bind(today).first();

  // "Most recent" = the project with the newest note or event.
  const { results: recent } = await env.DB.prepare(
    `SELECT project_id, MAX(t) AS t FROM (
       SELECT project_id, updated_at AS t FROM notes
       UNION ALL SELECT project_id, created_at AS t FROM events WHERE project_id IS NOT NULL
     ) GROUP BY project_id ORDER BY t DESC LIMIT 1`
  ).all();
  const featuredId = recent.length ? recent[0].project_id : projects[0] && projects[0].id;

  const openTodos = {};
  for (const t of todos) if (!t.done) openTodos[t.project_id] = (openTodos[t.project_id] || 0) + 1;
  const { results: todoCounts } = await env.DB.prepare(
    "SELECT project_id, COUNT(*) AS n FROM notes WHERE kind = 'todo' AND done = 0 GROUP BY project_id"
  ).all();
  const todoBy = Object.fromEntries(todoCounts.map((r) => [r.project_id, r.n]));

  return {
    today,
    projects: projects.map((p) => ({ ...p, links: links[p.id] || [], latest: latest[p.id] || null, open_todos: todoBy[p.id] || 0 })),
    featured: featuredId,
    todos,
    events,
    checks,
    open_incidents: openIncidents,
    money: { ...money, month: from },
    renewal,
  };
}

// ---------- projects ----------
function projectFields(b, partial) {
  const out = {};
  if (!partial || 'name' in b) out.name = need(str(b.name, 60), 'Name is required');
  if (!partial || 'initials' in b) out.initials = str(b.initials, 3) || (out.name || '').slice(0, 2).toUpperCase() || '?';
  if ('color' in b) { if (!COLOR_RE.test(b.color || '')) throw new HttpError(400, 'Color must be #RRGGBB'); out.color = b.color; }
  if ('ink' in b) { if (!COLOR_RE.test(b.ink || '')) throw new HttpError(400, 'Ink must be #RRGGBB'); out.ink = b.ink; }
  if ('type' in b) out.type = str(b.type, 60) || '';
  if ('status' in b) { if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Bad status'); out.status = b.status; }
  if ('description' in b) out.description = str(b.description, 300) || '';
  if ('hosting' in b) out.hosting = str(b.hosting, 40) || '';
  if ('archived' in b) out.archived = b.archived ? 1 : 0;
  return out;
}

async function getProject(env, id) {
  const p = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'No such project');
  const [{ results: links }, { results: notes }, { results: incidents }, { results: events }] = await Promise.all([
    env.DB.prepare('SELECT * FROM links WHERE project_id = ? ORDER BY sort, id').bind(id).all(),
    env.DB.prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY pinned DESC, created_at DESC, id DESC').bind(id).all(),
    env.DB.prepare('SELECT * FROM incidents WHERE project_id = ? ORDER BY started_at DESC LIMIT 10').bind(id).all(),
    env.DB.prepare('SELECT * FROM events WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 10').bind(id).all(),
  ]);
  const checks = (await statusRows(env)).filter((c) => c.project_id === id);
  return { project: p, links, notes, incidents, events, checks };
}

async function createProject(env, b) {
  const f = projectFields(b, false);
  let id = str(b.id, 24) || f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  if (!SLUG_RE.test(id)) throw new HttpError(400, 'Short id must be lowercase letters, numbers and dashes');
  if (await env.DB.prepare('SELECT 1 FROM projects WHERE id = ?').bind(id).first()) throw new HttpError(409, 'That id is taken');
  const { m } = (await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM projects').first());
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO projects (id, name, initials, color, ink, type, status, description, hosting, sort, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, f.name, f.initials, f.color || '#52525B', f.ink || '#FFFFFF', f.type || '', f.status || 'progress',
    f.description || '', f.hosting || '', m + 1, now, now).run();
  await logEvent(env, { project: id, text: `Added ${f.name}` });
  return getProject(env, id);
}

async function updateProject(env, id, b) {
  const f = projectFields(b, true);
  const keys = Object.keys(f);
  if (!keys.length) throw new HttpError(400, 'Nothing to change');
  const r = await env.DB.prepare(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => f[k]), Date.now(), id).run();
  if (!r.meta.changes) throw new HttpError(404, 'No such project');
  return getProject(env, id);
}

// ---------- notes ----------
async function createNote(env, b) {
  const project = need(str(b.project_id, 24), 'Pick a project');
  const p = await env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(project).first();
  if (!p) throw new HttpError(400, 'No such project');
  const kind = NOTE_KINDS.includes(b.kind) ? b.kind : 'note';
  const text = need(str(b.text, 2000), 'Write something first');
  const now = Date.now();
  const r = await env.DB.prepare('INSERT INTO notes (project_id, kind, text, pinned, done, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?)')
    .bind(project, kind, text, now, now).run();
  const label = { note: 'a note', todo: 'a to-do', idea: 'an idea', rule: 'a rule', infra: 'an infra note' }[kind];
  await logEvent(env, { project, text: `Added ${label}: ${text.length > 90 ? text.slice(0, 88) + '…' : text}` });
  return env.DB.prepare('SELECT * FROM notes WHERE id = ?').bind(r.meta.last_row_id).first();
}

async function updateNote(env, id, b) {
  const sets = [], vals = [];
  if ('text' in b) { sets.push('text = ?'); vals.push(need(str(b.text, 2000), 'Note is empty')); }
  if ('kind' in b) { if (!NOTE_KINDS.includes(b.kind)) throw new HttpError(400, 'Bad kind'); sets.push('kind = ?'); vals.push(b.kind); }
  if ('pinned' in b) { sets.push('pinned = ?'); vals.push(b.pinned ? 1 : 0); }
  if ('done' in b) { sets.push('done = ?'); vals.push(b.done ? 1 : 0); }
  if (!sets.length) throw new HttpError(400, 'Nothing to change');
  const r = await env.DB.prepare(`UPDATE notes SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...vals, Date.now(), id).run();
  if (!r.meta.changes) throw new HttpError(404, 'No such note');
  const note = await env.DB.prepare('SELECT * FROM notes WHERE id = ?').bind(id).first();
  if ('done' in b && b.done && note.kind === 'todo') {
    await logEvent(env, { project: note.project_id, level: 'good', text: `Finished: ${note.text.slice(0, 90)}` });
  }
  return note;
}

// Restores a deleted note exactly (used by Undo).
async function restoreNote(env, b) {
  const n = b && b.note;
  if (!n || !n.project_id || !n.text) throw new HttpError(400, 'Nothing to restore');
  const kind = NOTE_KINDS.includes(n.kind) ? n.kind : 'note';
  const r = await env.DB.prepare('INSERT INTO notes (project_id, kind, text, pinned, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(n.project_id, kind, String(n.text).slice(0, 2000), n.pinned ? 1 : 0, n.done ? 1 : 0, Number(n.created_at) || Date.now(), Date.now()).run();
  return env.DB.prepare('SELECT * FROM notes WHERE id = ?').bind(r.meta.last_row_id).first();
}

// ---------- links ----------
async function createLink(env, b) {
  const project = need(str(b.project_id, 24), 'Pick a project');
  const label = need(str(b.label, 40), 'Give the link a name');
  const url = need(httpUrl(b.url), 'Enter a full web address (https://…)');
  const { m } = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM links WHERE project_id = ?').bind(project).first();
  const r = await env.DB.prepare('INSERT INTO links (project_id, label, url, sort) VALUES (?, ?, ?, ?)').bind(project, label, url, m + 1).run();
  return env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(r.meta.last_row_id).first();
}

// ---------- monitoring ----------
async function monitoring(env) {
  const tz = tzOf(env);
  const today = todayLocal(tz);
  const from = addDays(today, -89);
  const [rawChecks, projects, spark] = await Promise.all([statusRows(env), allProjects(env), sparks(env)]);
  const checks = rawChecks.map((c) => ({ ...c, spark: spark[c.id] || [] }));
  // Daily rollup from raw results (day in UTC keeps the query simple and is close enough for a 90-day strip).
  const since = Date.parse(from + 'T00:00:00Z');
  const { results: daily } = await env.DB.prepare(
    `SELECT check_id, strftime('%Y-%m-%d', at / 1000, 'unixepoch') AS day, COUNT(*) AS total, SUM(ok) AS ok, AVG(ms) AS ms
       FROM check_results WHERE at >= ? GROUP BY check_id, day`
  ).bind(since).all();
  const { results: totals } = await env.DB.prepare(
    'SELECT check_id, COUNT(*) AS total, SUM(ok) AS ok FROM check_results WHERE at >= ? GROUP BY check_id'
  ).bind(since).all();
  const { results: incidents } = await env.DB.prepare(
    `SELECT i.*, p.name AS project_name, p.color FROM incidents i LEFT JOIN projects p ON p.id = i.project_id
      ORDER BY i.started_at DESC LIMIT 20`
  ).all();
  const { n: pushDevices } = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs').first();
  const byCheck = {};
  for (const d of daily) (byCheck[d.check_id] ||= {})[d.day] = d;
  const totalBy = Object.fromEntries(totals.map((t) => [t.check_id, t]));
  return {
    from, today, projects,
    checks: checks.map((c) => ({ ...c, days: byCheck[c.id] || {}, uptime: totalBy[c.id] ? totalBy[c.id].ok / totalBy[c.id].total : null })),
    incidents,
    push_devices: pushDevices,
    vapid_public: (await vapidKeys(env)).pub,
  };
}

async function createCheck(env, b) {
  const project = need(str(b.project_id, 24), 'Pick a project');
  const name = need(str(b.name, 40), 'Name the check');
  const url = need(httpUrl(b.url), 'Enter a full web address (https://…)');
  const expect = b.expect_status ? Number.parseInt(b.expect_status, 10) : null;
  const r = await env.DB.prepare('INSERT INTO checks (project_id, name, url, expect_status, expect_text, enabled, sort) VALUES (?, ?, ?, ?, ?, 1, 99)')
    .bind(project, name, url, expect, str(b.expect_text, 120)).run();
  return env.DB.prepare('SELECT * FROM checks WHERE id = ?').bind(r.meta.last_row_id).first();
}

// ---------- finances ----------
async function finances(env, url) {
  const tz = tzOf(env);
  const today = todayLocal(tz);
  const period = url.searchParams.get('period') === 'year' ? 'year' : 'month';
  const [from, to] = period === 'year' ? [today.slice(0, 4) + '-01-01', today.slice(0, 4) + '-12-31'] : monthRange(today);
  const totals = await moneySummary(env, from, to);
  const { results: byProject } = await env.DB.prepare(
    `SELECT l.project_id, p.name, p.color, l.kind, SUM(l.amount_cents) AS cents
       FROM ledger l LEFT JOIN projects p ON p.id = l.project_id
      WHERE l.occurred_on BETWEEN ? AND ? GROUP BY l.project_id, l.kind`
  ).bind(from, to).all();
  const sixAgo = monthRange(addDays(today.slice(0, 8) + '01', -150))[0];
  const { results: history } = await env.DB.prepare(
    `SELECT substr(occurred_on, 1, 7) AS month, kind, SUM(amount_cents) AS cents FROM ledger
      WHERE occurred_on >= ? GROUP BY month, kind ORDER BY month`
  ).bind(sixAgo).all();
  const { results: rows } = await env.DB.prepare(
    `SELECT l.*, p.name AS project_name, p.color FROM ledger l LEFT JOIN projects p ON p.id = l.project_id
      ORDER BY l.occurred_on DESC, l.id DESC LIMIT 50`
  ).all();
  const { results: renewals } = await env.DB.prepare(
    `SELECT r.*, p.name AS project_name FROM renewals r LEFT JOIN projects p ON p.id = r.project_id ORDER BY r.renews_on`
  ).all();
  return { period, from, to, today, totals, by_project: byProject, history, rows, renewals, projects: await allProjects(env) };
}

async function createLedger(env, b) {
  const kind = LEDGER_KINDS.includes(b.kind) ? b.kind : 'cost';
  const description = need(str(b.description, 200), 'Describe it');
  const cents = Math.round(Number(b.amount) * 100);
  if (!Number.isFinite(cents) || cents <= 0) throw new HttpError(400, 'Enter an amount above $0');
  const tz = tzOf(env);
  const on = DATE_RE.test(b.occurred_on || '') ? b.occurred_on : todayLocal(tz);
  const project = str(b.project_id, 24);
  const r = await env.DB.prepare(
    "INSERT INTO ledger (project_id, kind, source, description, amount_cents, occurred_on, created_at) VALUES (?, ?, 'manual', ?, ?, ?, ?)"
  ).bind(project, kind, description, cents, on, Date.now()).run();
  return env.DB.prepare('SELECT * FROM ledger WHERE id = ?').bind(r.meta.last_row_id).first();
}

async function createRenewal(env, b) {
  const domain = need(str(b.domain, 120), 'Enter the domain');
  if (!DATE_RE.test(b.renews_on || '')) throw new HttpError(400, 'Pick the renewal date');
  const cents = Math.round(Number(b.price || 0) * 100);
  const r = await env.DB.prepare('INSERT INTO renewals (project_id, domain, renews_on, price_cents, auto) VALUES (?, ?, ?, ?, ?)')
    .bind(str(b.project_id, 24), domain, b.renews_on, Number.isFinite(cents) ? cents : 0, b.auto === false ? 0 : 1).run();
  return env.DB.prepare('SELECT * FROM renewals WHERE id = ?').bind(r.meta.last_row_id).first();
}

// ---------- push ----------
async function subscribe(env, b) {
  const s = b && b.subscription;
  if (!s || !httpUrl(s.endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) throw new HttpError(400, 'Bad subscription');
  await env.DB.prepare(
    `INSERT INTO push_subs (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
  ).bind(s.endpoint, s.keys.p256dh, s.keys.auth, Date.now()).run();
  return { ok: true };
}

// ---------- router ----------
export async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method;
  let m;

  if (method === 'GET' && path === '/dashboard') return json(await dashboard(env));
  if (method === 'GET' && path === '/search') return json(await search(env, url.searchParams.get('q')));
  if (method === 'GET' && path === '/projects') return json({ projects: await allProjects(env) });
  if (method === 'POST' && path === '/projects') return json(await createProject(env, await readJson(request)), 201);
  if ((m = path.match(/^\/projects\/([a-z0-9-]+)$/))) {
    if (method === 'GET') return json(await getProject(env, m[1]));
    if (method === 'PATCH') return json(await updateProject(env, m[1], await readJson(request)));
  }

  if (method === 'POST' && path === '/notes') return json(await createNote(env, await readJson(request)), 201);
  if (method === 'POST' && path === '/notes/restore') return json(await restoreNote(env, await readJson(request)), 201);
  if ((m = path.match(/^\/notes\/(\d+)$/))) {
    if (method === 'PATCH') return json(await updateNote(env, Number(m[1]), await readJson(request)));
    if (method === 'DELETE') {
      const note = await env.DB.prepare('SELECT * FROM notes WHERE id = ?').bind(Number(m[1])).first();
      if (!note) throw new HttpError(404, 'No such note');
      await env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(note.id).run();
      return json({ ok: true, note });
    }
  }

  if (method === 'POST' && path === '/links') return json(await createLink(env, await readJson(request)), 201);
  if ((m = path.match(/^\/links\/(\d+)$/)) && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM links WHERE id = ?').bind(Number(m[1])).run();
    return json({ ok: true });
  }

  if (method === 'GET' && path === '/monitoring') return json(await monitoring(env));
  if (method === 'POST' && path === '/monitoring/run') return json({ results: await runChecks(env, ctx) });
  if (method === 'POST' && path === '/checks') return json(await createCheck(env, await readJson(request)), 201);
  if ((m = path.match(/^\/checks\/(\d+)$/))) {
    if (method === 'PATCH') {
      const b = await readJson(request);
      await env.DB.prepare('UPDATE checks SET enabled = ? WHERE id = ?').bind(b.enabled ? 1 : 0, Number(m[1])).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM checks WHERE id = ?').bind(Number(m[1])).run();
      return json({ ok: true });
    }
  }
  if ((m = path.match(/^\/incidents\/(\d+)\/resolve$/)) && method === 'POST') {
    await env.DB.prepare('UPDATE incidents SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL').bind(Date.now(), Number(m[1])).run();
    return json({ ok: true });
  }

  if (method === 'GET' && path === '/finances') return json(await finances(env, url));
  if (method === 'POST' && path === '/ledger') return json(await createLedger(env, await readJson(request)), 201);
  if ((m = path.match(/^\/ledger\/(\d+)$/)) && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM ledger WHERE id = ?').bind(Number(m[1])).run();
    return json({ ok: true });
  }
  if (method === 'POST' && path === '/renewals') return json(await createRenewal(env, await readJson(request)), 201);
  if ((m = path.match(/^\/renewals\/(\d+)$/)) && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM renewals WHERE id = ?').bind(Number(m[1])).run();
    return json({ ok: true });
  }
  if (method === 'GET' && path === '/ledger.csv') {
    const { results } = await env.DB.prepare(
      'SELECT l.occurred_on, p.name AS project, l.kind, l.source, l.description, l.amount_cents, l.external_id FROM ledger l LEFT JOIN projects p ON p.id = l.project_id ORDER BY l.occurred_on, l.id'
    ).all();
    const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = ['date,project,kind,source,description,amount_usd,external_id',
      ...results.map((r) => [r.occurred_on, r.project, r.kind, r.source, r.description, (r.amount_cents / 100).toFixed(2), r.external_id].map(esc).join(','))];
    return new Response(lines.join('\n') + '\n', {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="mazzagotte-ledger.csv"', 'cache-control': 'no-store' },
    });
  }

  if (method === 'GET' && path === '/push/key') return json({ key: (await vapidKeys(env)).pub });
  if (method === 'POST' && path === '/push/subscribe') return json(await subscribe(env, await readJson(request)));
  if (method === 'POST' && path === '/push/test') {
    await pushAll(env, { title: 'mazzagotte.dev', body: 'Notifications are working.', url: '/#/monitoring', tag: 'test' });
    return json({ ok: true });
  }
  if (method === 'GET' && path === '/me') return json({ email: request.__owner && request.__owner.email });

  throw new HttpError(404, 'Not found');
}
