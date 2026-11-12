// The hub's API. Everything here sits behind Cloudflare Access (see index.js).
import { runChecks } from './checks.js';
import { listBackups, runBackups } from './backup.js';
import { repoFeed, repoFromUrl } from './github.js';
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

// Limit a ledger/bill query to one site ('_' = shared costs with no site), or none for every site.
function siteWhere(site, col = 'project_id') {
  if (!site) return { sql: '', vals: [] };
  if (site === '_') return { sql: ` AND ${col} IS NULL`, vals: [] };
  return { sql: ` AND ${col} = ?`, vals: [site] };
}

async function moneySummary(env, from, to, site = '') {
  const w = siteWhere(site);
  const { results } = await env.DB.prepare(
    `SELECT kind, SUM(amount_cents) AS cents FROM ledger WHERE occurred_on BETWEEN ? AND ?${w.sql} GROUP BY kind`
  ).bind(from, to, ...w.vals).all();
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
  // Operating costs, break-even and what's due soon, for the Money card.
  const [{ results: bills }, { results: doms }, tm] = await Promise.all([
    env.DB.prepare('SELECT r.*, p.name AS project_name, p.color FROM recurring r LEFT JOIN projects p ON p.id = r.project_id WHERE r.active = 1').all(),
    env.DB.prepare('SELECT r.*, p.name AS project_name, p.color FROM renewals r LEFT JOIN projects p ON p.id = r.project_id').all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind = 'income' AND project_id = 'tc' AND occurred_on BETWEEN ? AND ?").bind(from, to).first(),
  ]);
  const fixed = bills.reduce((a, r) => a + monthlyOf(r), 0) + doms.reduce((a, r) => a + Math.round(r.price_cents / 12), 0);
  const soon = addDays(today, 30);
  const upcoming = [
    ...bills.filter((r) => r.next_on <= soon).map((r) => ({ name: r.name, on: r.next_on, cents: r.amount_cents, color: r.color, type: 'bill' })),
    ...doms.filter((r) => r.renews_on >= today && r.renews_on <= soon).map((r) => ({ name: r.domain, on: r.renews_on, cents: r.price_cents, color: r.color, type: 'domain' })),
  ].sort((a, b) => a.on.localeCompare(b.on)).slice(0, 3);
  const ops = { fixed, break_even: fixed ? Math.ceil(fixed / NET_PER_TOURNAMENT) : 0, tournaments: tm.n, net_per: NET_PER_TOURNAMENT, upcoming };

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
    ops,
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
    // Activity = things that happened (deploys, outages, money, finished to-dos), not notes you just wrote.
    env.DB.prepare(`SELECT * FROM events WHERE project_id = ? AND source != 'note' AND text NOT LIKE 'Added a %' AND text NOT LIKE 'Added an %'
      ORDER BY created_at DESC, id DESC LIMIT 10`).bind(id).all(),
  ]);
  const checks = (await statusRows(env)).filter((c) => c.project_id === id);
  // Key facts for the header.
  const today = todayLocal(tzOf(env));
  const [mFrom, mTo] = monthRange(today);
  const since = Date.now() - 30 * 86400_000;
  const [money, up, deploy, { results: files }] = await Promise.all([
    moneySummary(env, mFrom, mTo, id),
    checks.length ? env.DB.prepare(`SELECT COUNT(*) AS total, SUM(ok) AS ok, AVG(ms) AS ms FROM check_results WHERE at >= ? AND check_id IN (${checks.map(() => '?').join(',')})`).bind(since, ...checks.map((c) => c.id)).first() : null,
    env.DB.prepare("SELECT * FROM events WHERE project_id = ? AND source IN ('deploy', 'railway') AND text LIKE '%deploy%' ORDER BY created_at DESC LIMIT 1").bind(id).first(),
    env.DB.prepare('SELECT f.* FROM note_files f JOIN notes n ON n.id = f.note_id WHERE n.project_id = ? ORDER BY f.created_at').bind(id).all(),
  ]);
  const facts = {
    uptime: up && up.total ? up.ok / up.total : null, avg_ms: up && up.ms ? Math.round(up.ms) : null,
    income: money.income, costs: money.costs, last_deploy: deploy,
  };
  return { project: p, links, notes, incidents, events, checks, facts, files };
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
  const due = kind === 'todo' && DATE_RE.test(b.due_on || '') ? b.due_on : null;
  const { s: top } = await env.DB.prepare("SELECT COALESCE(MIN(sort), 0) - 1 AS s FROM notes WHERE kind = 'todo'").first();
  const r = await env.DB.prepare('INSERT INTO notes (project_id, kind, text, pinned, done, created_at, updated_at, due_on, sort) VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?)')
    .bind(project, kind, text, now, now, due, kind === 'todo' ? top : null).run();
  const label = { note: 'a note', todo: 'a to-do', idea: 'an idea', rule: 'a rule', infra: 'an infra note' }[kind];
  await logEvent(env, { project, source: 'note', text: `Added ${label}: ${text.length > 90 ? text.slice(0, 88) + '…' : text}` });
  return env.DB.prepare('SELECT * FROM notes WHERE id = ?').bind(r.meta.last_row_id).first();
}

async function updateNote(env, id, b) {
  const sets = [], vals = [];
  if ('text' in b) { sets.push('text = ?'); vals.push(need(str(b.text, 2000), 'Note is empty')); }
  if ('kind' in b) { if (!NOTE_KINDS.includes(b.kind)) throw new HttpError(400, 'Bad kind'); sets.push('kind = ?'); vals.push(b.kind); }
  if ('pinned' in b) { sets.push('pinned = ?'); vals.push(b.pinned ? 1 : 0); }
  if ('done' in b) { sets.push('done = ?', 'done_at = ?'); vals.push(b.done ? 1 : 0, b.done ? Date.now() : null); }
  if ('due_on' in b) { if (b.due_on && !DATE_RE.test(b.due_on)) throw new HttpError(400, 'Bad date'); sets.push('due_on = ?'); vals.push(b.due_on || null); }
  if ('project_id' in b) { const p = await env.DB.prepare('SELECT 1 FROM projects WHERE id = ?').bind(str(b.project_id, 24)).first(); if (!p) throw new HttpError(400, 'No such project'); sets.push('project_id = ?'); vals.push(b.project_id); }
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
  const nid = r.meta.last_row_id;
  if (n.due_on || n.sort != null) await env.DB.prepare('UPDATE notes SET due_on = ?, sort = ? WHERE id = ?').bind(DATE_RE.test(n.due_on || '') ? n.due_on : null, n.sort ?? null, nid).run();
  const fileIds = (Array.isArray(b.files) ? b.files : []).map(Number).filter(Number.isFinite);
  if (fileIds.length) await env.DB.prepare(`UPDATE note_files SET note_id = ?, orphaned_at = NULL WHERE id IN (${fileIds.map(() => '?').join(',')}) AND note_id IS NULL`).bind(nid, ...fileIds).run();
  return env.DB.prepare('SELECT * FROM notes WHERE id = ?').bind(nid).first();
}

// ---------- files on notes ----------
const MAX_FILE = 25 * 1024 * 1024;
async function uploadFile(env, request, noteId) {
  if (!env.FILES) throw new HttpError(503, 'File storage is not connected');
  const note = await env.DB.prepare('SELECT id, project_id FROM notes WHERE id = ?').bind(noteId).first();
  if (!note) throw new HttpError(404, 'No such note');
  const form = await request.formData().catch(() => null);
  const file = form && form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'Choose a file');
  if (file.size > MAX_FILE) throw new HttpError(413, 'Files can be up to 25 MB');
  const name = String(file.name || 'file').slice(0, 120);
  // Only types we can show or download safely; anything else is stored as a plain download.
  const type = /^(image\/(png|jpe?g|gif|webp|avif|heic)|application\/pdf|text\/plain|text\/csv|application\/zip|application\/json|application\/vnd\.openxmlformats-officedocument\.[\w.]+|application\/msword|application\/vnd\.ms-excel)$/i.test(file.type || '') ? file.type : 'application/octet-stream';
  const key = `notes/${note.project_id}/${noteId}/${crypto.randomUUID()}`;
  await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: type } });
  const r = await env.DB.prepare('INSERT INTO note_files (note_id, project_id, key, name, type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(noteId, note.project_id, key, name, type, file.size, Date.now()).run();
  return env.DB.prepare('SELECT * FROM note_files WHERE id = ?').bind(r.meta.last_row_id).first();
}

// Daily: remove files whose note was deleted more than a day ago (past the Undo window).
export async function cleanupFiles(env) {
  const { results } = await env.DB.prepare('SELECT id, key FROM note_files WHERE note_id IS NULL AND orphaned_at < ?').bind(Date.now() - 86400_000).all();
  if (!results.length) return;
  if (env.FILES) await env.FILES.delete(results.map((f) => f.key));
  await env.DB.batch(results.map((f) => env.DB.prepare('DELETE FROM note_files WHERE id = ?').bind(f.id)));
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
// What one $5 tournament leaves after Stripe's cut (2.9% + 30¢), which we absorb.
const NET_PER_TOURNAMENT = 500 - Math.round(500 * 0.029) - 30;

function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}
const monthlyOf = (r) => (r.cadence === 'yearly' ? Math.round(r.amount_cents / 12) : r.amount_cents);

// Log one domain renewal as a cost on its site and move it to next year.
async function renewDomain(env, r, on) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO ledger (project_id, kind, source, description, amount_cents, occurred_on, external_id, created_at)
     VALUES (?, 'cost', 'domain', ?, ?, ?, ?, ?)`
  ).bind(r.project_id, `Domain renewal — ${r.domain}`, r.price_cents, on, `dom:${r.id}:${r.renews_on}`, Date.now()).run();
  await env.DB.prepare('UPDATE renewals SET renews_on = ? WHERE id = ?').bind(addMonths(r.renews_on, 12), r.id).run();
}

// Post every recurring bill and auto-renewing domain that has come due (catching up if a few were missed), once each.
export async function postRecurring(env) {
  const today = todayLocal(tzOf(env));
  const { results: due } = await env.DB.prepare('SELECT * FROM renewals WHERE auto = 1 AND renews_on <= ?').bind(today).all();
  for (const r0 of due) {
    let r = r0;
    for (let i = 0; i < 5 && r.renews_on <= today; i++) {
      await renewDomain(env, r, r.renews_on);
      r = { ...r, renews_on: addMonths(r.renews_on, 12) };
    }
  }
  const { results } = await env.DB.prepare('SELECT * FROM recurring WHERE active = 1 AND next_on <= ?').bind(today).all();
  for (const r of results) {
    let on = r.next_on;
    for (let i = 0; i < 24 && on <= today; i++) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO ledger (project_id, kind, source, description, amount_cents, occurred_on, external_id, created_at)
         VALUES (?, 'cost', 'recurring', ?, ?, ?, ?, ?)`
      ).bind(r.project_id, r.name, r.amount_cents, on, `rec:${r.id}:${on}`, Date.now()).run();
      on = addMonths(on, r.cadence === 'yearly' ? 12 : 1);
    }
    await env.DB.prepare('UPDATE recurring SET next_on = ? WHERE id = ?').bind(on, r.id).run();
  }
}

async function finances(env, url) {
  await postRecurring(env);
  const tz = tzOf(env);
  const today = todayLocal(tz);
  const period = url.searchParams.get('period') === 'year' ? 'year' : 'month';
  const [from, to] = period === 'year' ? [today.slice(0, 4) + '-01-01', today.slice(0, 4) + '-12-31'] : monthRange(today);
  // Same stretch last time, up to the same day, so the comparison is fair mid-month.
  const prevFrom = period === 'year' ? addMonths(from, -12) : addMonths(from, -1);
  const prevTo = period === 'year' ? addMonths(today, -12) : addMonths(today, -1);
  const projects = await allProjects(env);
  const sp = String(url.searchParams.get('site') || '');
  const site = sp === '_' || projects.some((p) => p.id === sp) ? sp : '';
  const sw = siteWhere(site, 'l.project_id');
  const [totals, prev] = await Promise.all([moneySummary(env, from, to, site), moneySummary(env, prevFrom, prevTo, site)]);

  const tCount = async (a, b2) => (await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM ledger WHERE kind = 'income' AND project_id = 'tc' AND occurred_on BETWEEN ? AND ?"
  ).bind(a, b2).first()).n;
  const [monthFrom, monthTo] = monthRange(today);
  const [tournaments, tournamentsPrev, tournamentsMonth] = await Promise.all([tCount(from, to), tCount(prevFrom, prevTo), tCount(monthFrom, monthTo)]);

  // Every site, even ones with nothing recorded, plus shared costs.
  const { results: sums } = await env.DB.prepare(
    `SELECT project_id, kind, SUM(amount_cents) AS cents FROM ledger WHERE occurred_on BETWEEN ? AND ? GROUP BY project_id, kind`
  ).bind(from, to).all();
  const site0 = (id, name, color) => ({ project_id: id, name, color, income: 0, costs: 0, bills_monthly: 0 });
  const bySite = Object.fromEntries(projects.map((p) => [p.id, site0(p.id, p.name, p.color)]));
  bySite._ = site0(null, 'Shared costs', '#71717A');
  for (const r of sums) { const b = bySite[r.project_id || '_']; if (!b) continue; if (r.kind === 'income') b.income += r.cents; else b.costs += r.cents; }
  const { results: history } = await env.DB.prepare(
    `SELECT substr(l.occurred_on, 1, 7) AS month, l.kind, SUM(l.amount_cents) AS cents FROM ledger l
      WHERE l.occurred_on >= ?${sw.sql} GROUP BY month, l.kind ORDER BY month`
  ).bind(addMonths(monthFrom, -11), ...sw.vals).all();

  // Ledger with filters: kind=in|out, project, q, limit.
  const where = []; const vals = [];
  const k = url.searchParams.get('kind');
  if (k === 'in') where.push("l.kind = 'income'");
  if (k === 'out') where.push("l.kind != 'income'");
  const fp = site || url.searchParams.get('project');
  if (fp === '_') where.push('l.project_id IS NULL'); else if (fp) { where.push('l.project_id = ?'); vals.push(fp); }
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
  if (q) { where.push("l.description LIKE ? ESCAPE '\\'"); vals.push('%' + q.replace(/[%_\\]/g, (c) => '\\' + c) + '%'); }
  const limit = Math.min(500, Math.max(20, Number.parseInt(url.searchParams.get('limit'), 10) || 50));
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { results: rows } = await env.DB.prepare(
    `SELECT l.*, p.name AS project_name, p.color FROM ledger l LEFT JOIN projects p ON p.id = l.project_id ${w}
      ORDER BY l.occurred_on DESC, l.id DESC LIMIT ?`
  ).bind(...vals, limit + 1).all();
  const more = rows.length > limit;

  const { results: allRenewals } = await env.DB.prepare(
    `SELECT r.*, p.name AS project_name, p.color FROM renewals r LEFT JOIN projects p ON p.id = r.project_id ORDER BY r.renews_on`
  ).all();
  const { results: allRecurring } = await env.DB.prepare(
    `SELECT r.*, p.name AS project_name, p.color FROM recurring r LEFT JOIN projects p ON p.id = r.project_id ORDER BY r.active DESC, r.next_on`
  ).all();
  const mine = (r) => !site || (site === '_' ? !r.project_id : r.project_id === site);
  const renewals = allRenewals.filter(mine);
  const recurring = allRecurring.filter(mine);
  // Monthly running cost of each site: active bills + domains spread over the year.
  for (const r of allRecurring) if (r.active) (bySite[r.project_id || '_'] || bySite._).bills_monthly += monthlyOf(r);
  for (const r of allRenewals) (bySite[r.project_id || '_'] || bySite._).bills_monthly += Math.round(r.price_cents / 12);
  const fixed = recurring.filter((r) => r.active).reduce((a, r) => a + monthlyOf(r), 0)
    + renewals.reduce((a, r) => a + Math.round(r.price_cents / 12), 0);
  const fixedAll = Object.values(bySite).reduce((a, b2) => a + b2.bills_monthly, 0);
  const breakEven = fixed ? Math.ceil(fixed / NET_PER_TOURNAMENT) : 0;

  const horizon = addDays(today, 60);
  const upcoming = [
    ...recurring.filter((r) => r.active && r.next_on <= horizon).map((r) => ({ type: 'bill', name: r.name, on: r.next_on, cents: r.amount_cents, project_name: r.project_name, color: r.color })),
    ...renewals.filter((r) => r.renews_on >= today && r.renews_on <= horizon).map((r) => ({ type: 'domain', name: r.domain, on: r.renews_on, cents: r.price_cents, project_name: r.project_name, color: r.color })),
  ].sort((a, b2) => a.on.localeCompare(b2.on));

  return {
    period, from, to, today, site, totals, prev, tournaments, tournaments_prev: tournamentsPrev, tournaments_month: tournamentsMonth,
    fixed_monthly: fixed, fixed_all: fixedAll, break_even: breakEven, net_per_tournament: NET_PER_TOURNAMENT,
    by_site: Object.values(bySite), history, rows: rows.slice(0, limit), more, renewals, recurring, upcoming, projects,
  };
}

function ledgerFields(b, env) {
  const out = {};
  if ('kind' in b) out.kind = LEDGER_KINDS.includes(b.kind) ? b.kind : 'cost';
  if ('description' in b) out.description = need(str(b.description, 200), 'Describe it');
  if ('amount' in b) {
    const cents = Math.round(Number(b.amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) throw new HttpError(400, 'Enter an amount above $0');
    out.amount_cents = cents;
  }
  if ('occurred_on' in b) out.occurred_on = DATE_RE.test(b.occurred_on || '') ? b.occurred_on : todayLocal(tzOf(env));
  if ('project_id' in b) out.project_id = str(b.project_id, 24) || null;
  return out;
}

async function createLedger(env, b) {
  const f = ledgerFields({ kind: 'cost', occurred_on: '', project_id: '', ...b }, env);
  if (!f.description || !f.amount_cents) throw new HttpError(400, 'Describe it and enter an amount');
  const r = await env.DB.prepare(
    "INSERT INTO ledger (project_id, kind, source, description, amount_cents, occurred_on, created_at) VALUES (?, ?, 'manual', ?, ?, ?, ?)"
  ).bind(f.project_id, f.kind, f.description, f.amount_cents, f.occurred_on, Date.now()).run();
  return env.DB.prepare('SELECT * FROM ledger WHERE id = ?').bind(r.meta.last_row_id).first();
}

async function updateLedger(env, id, b) {
  const row = await env.DB.prepare('SELECT * FROM ledger WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'No such entry');
  // Stripe entries are the record of real charges; only their site can change.
  const f = ledgerFields(row.source === 'stripe' ? { project_id: b.project_id } : b, env);
  const keys = Object.keys(f);
  if (keys.length) await env.DB.prepare(`UPDATE ledger SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`).bind(...keys.map((k) => f[k]), id).run();
  return env.DB.prepare('SELECT * FROM ledger WHERE id = ?').bind(id).first();
}

async function createRecurring(env, b) {
  const name = need(str(b.name, 80), 'Name the bill');
  const cents = Math.round(Number(b.amount) * 100);
  if (!Number.isFinite(cents) || cents <= 0) throw new HttpError(400, 'Enter an amount above $0');
  const cadence = b.cadence === 'yearly' ? 'yearly' : 'monthly';
  if (!DATE_RE.test(b.next_on || '')) throw new HttpError(400, 'Pick the next charge date');
  const r = await env.DB.prepare('INSERT INTO recurring (project_id, name, amount_cents, cadence, next_on, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
    .bind(str(b.project_id, 24) || null, name, cents, cadence, b.next_on, Date.now()).run();
  await postRecurring(env);
  return env.DB.prepare('SELECT * FROM recurring WHERE id = ?').bind(r.meta.last_row_id).first();
}

async function domains(env) {
  await postRecurring(env);
  const today = todayLocal(tzOf(env));
  const { results } = await env.DB.prepare(
    `SELECT r.*, p.name AS project_name, p.color, p.initials, p.ink FROM renewals r LEFT JOIN projects p ON p.id = r.project_id ORDER BY r.renews_on, r.domain`
  ).all();
  return { today, domains: results, projects: await allProjects(env) };
}

async function updateRenewal(env, id, b) {
  const sets = []; const vals = [];
  if ('domain' in b) { sets.push('domain = ?'); vals.push(need(str(b.domain, 120), 'Enter the domain')); }
  if ('renews_on' in b) { if (!DATE_RE.test(b.renews_on || '')) throw new HttpError(400, 'Pick the renewal date'); sets.push('renews_on = ?'); vals.push(b.renews_on); }
  if ('price' in b) { const c = Math.round(Number(b.price || 0) * 100); sets.push('price_cents = ?'); vals.push(Number.isFinite(c) && c >= 0 ? c : 0); }
  if ('project_id' in b) { sets.push('project_id = ?'); vals.push(str(b.project_id, 24) || null); }
  if ('auto' in b) { sets.push('auto = ?'); vals.push(b.auto === true || b.auto === 'on' || b.auto === '1' ? 1 : 0); }
  if (sets.length) await env.DB.prepare(`UPDATE renewals SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  return env.DB.prepare('SELECT * FROM renewals WHERE id = ?').bind(id).first();
}

async function createRenewal(env, b) {
  const domain = need(str(b.domain, 120), 'Enter the domain');
  if (!DATE_RE.test(b.renews_on || '')) throw new HttpError(400, 'Pick the renewal date');
  const cents = Math.round(Number(b.price || 0) * 100);
  const r = await env.DB.prepare('INSERT INTO renewals (project_id, domain, renews_on, price_cents, auto) VALUES (?, ?, ?, ?, ?)')
    .bind(str(b.project_id, 24) || null, domain, b.renews_on, Number.isFinite(cents) ? cents : 0, b.auto === false || b.auto === '0' ? 0 : 1).run();
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
  if (method === 'GET' && path === '/todos') {
    const { results } = await env.DB.prepare(
      `SELECT n.*, p.name AS project_name, p.color, p.initials, p.ink FROM notes n JOIN projects p ON p.id = n.project_id
        WHERE n.kind = 'todo' AND p.archived = 0 AND (n.done = 0 OR n.done_at IS NULL OR n.done_at > ?)
        ORDER BY n.done, COALESCE(n.sort, 1e9), n.created_at DESC`
    ).bind(Date.now() - 14 * 86400_000).all();
    return json({ today: todayLocal(tzOf(env)), todos: results, projects: await allProjects(env) });
  }
  if (method === 'POST' && path === '/todos/order') {
    const b = await readJson(request);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isFinite).slice(0, 500);
    if (ids.length) await env.DB.batch(ids.map((id, i) => env.DB.prepare('UPDATE notes SET sort = ? WHERE id = ?').bind(i, id)));
    return json({ ok: true });
  }
  if ((m = path.match(/^\/projects\/([a-z0-9-]+)\/github$/)) && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT url FROM links WHERE project_id = ? ORDER BY sort, id').bind(m[1]).all();
    const repo = results.map((l) => repoFromUrl(l.url)).find(Boolean);
    if (!repo) return json({ none: true });
    return json(await repoFeed(env, repo, { fresh: url.searchParams.get('fresh') === '1' }));
  }
  if (method === 'GET' && path === '/backups') return json(await listBackups(env));
  if (method === 'POST' && path === '/backups/run') return json({ results: await runBackups(env, ctx) });
  if (method === 'GET' && path === '/backups/file') {
    const key = url.searchParams.get('key') || '';
    if (!/^(hub|sparetime|usbc)\/\d{4}-\d{2}-\d{2}\.json\.gz$/.test(key) || !env.BACKUPS) throw new HttpError(404, 'No such backup');
    const obj = await env.BACKUPS.get(key);
    if (!obj) throw new HttpError(404, 'No such backup');
    return new Response(obj.body, { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${key.replace('/', '-')}"`, 'cache-control': 'no-store' } });
  }
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
      const { results: nf } = await env.DB.prepare('SELECT id FROM note_files WHERE note_id = ?').bind(note.id).all();
      await env.DB.batch([
        env.DB.prepare('UPDATE note_files SET note_id = NULL, orphaned_at = ? WHERE note_id = ?').bind(Date.now(), note.id),
        env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(note.id),
      ]);
      return json({ ok: true, note, files: nf.map((f) => f.id) });
    }
  }

  if (method === 'POST' && path === '/links/order') {
    const b = await readJson(request);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isFinite).slice(0, 200);
    if (ids.length) await env.DB.batch(ids.map((lid, i) => env.DB.prepare('UPDATE links SET sort = ? WHERE id = ?').bind(i + 1, lid)));
    return json({ ok: true });
  }
  if ((m = path.match(/^\/notes\/(\d+)\/files$/)) && method === 'POST') return json(await uploadFile(env, request, Number(m[1])), 201);
  if ((m = path.match(/^\/files\/(\d+)$/))) {
    const f = await env.DB.prepare('SELECT * FROM note_files WHERE id = ?').bind(Number(m[1])).first();
    if (!f) throw new HttpError(404, 'No such file');
    if (method === 'DELETE') {
      if (env.FILES) await env.FILES.delete(f.key);
      await env.DB.prepare('DELETE FROM note_files WHERE id = ?').bind(f.id).run();
      return json({ ok: true });
    }
    if (method === 'GET') {
      const obj = env.FILES && await env.FILES.get(f.key);
      if (!obj) throw new HttpError(404, 'File is missing');
      const inline = /^image\/(png|jpe?g|gif|webp|avif)$/.test(f.type) || f.type === 'application/pdf';
      const safe = f.name.replace(/[^\w.\- ]+/g, '_');
      return new Response(obj.body, { headers: {
        'content-type': f.type, 'content-length': String(f.size), 'cache-control': 'private, max-age=86400',
        'content-disposition': `${inline && url.searchParams.get('dl') !== '1' ? 'inline' : 'attachment'}; filename="${safe}"`,
        'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      } });
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
  if ((m = path.match(/^\/ledger\/(\d+)$/))) {
    if (method === 'PATCH') return json(await updateLedger(env, Number(m[1]), await readJson(request)));
    if (method === 'DELETE') {
      await env.DB.prepare("DELETE FROM ledger WHERE id = ? AND source != 'stripe'").bind(Number(m[1])).run();
      return json({ ok: true });
    }
  }
  // Turn a one-time cost into a repeating bill; the entry already logged becomes its first charge.
  if ((m = path.match(/^\/ledger\/(\d+)\/recur$/)) && method === 'POST') {
    const b = await readJson(request);
    const row = await env.DB.prepare('SELECT * FROM ledger WHERE id = ?').bind(Number(m[1])).first();
    if (!row) throw new HttpError(404, 'No such entry');
    if (row.kind === 'income' || row.source !== 'manual') throw new HttpError(400, 'Only one-time costs you added can become a bill');
    const cadence = b.cadence === 'yearly' ? 'yearly' : 'monthly';
    const next = addMonths(row.occurred_on, cadence === 'yearly' ? 12 : 1);
    const r = await env.DB.prepare('INSERT INTO recurring (project_id, name, amount_cents, cadence, next_on, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .bind(row.project_id, row.description, row.amount_cents, cadence, next, Date.now()).run();
    const rid = r.meta.last_row_id;
    await env.DB.prepare("UPDATE ledger SET source = 'recurring', external_id = ? WHERE id = ?").bind(`rec:${rid}:${row.occurred_on}`, row.id).run();
    await postRecurring(env);
    return json(await env.DB.prepare('SELECT * FROM recurring WHERE id = ?').bind(rid).first(), 201);
  }
  if (method === 'POST' && path === '/recurring') return json(await createRecurring(env, await readJson(request)), 201);
  if ((m = path.match(/^\/recurring\/(\d+)$/))) {
    if (method === 'PATCH') {
      const b = await readJson(request);
      const sets = []; const vals = [];
      if ('active' in b) { sets.push('active = ?'); vals.push(b.active ? 1 : 0); }
      if ('name' in b) { sets.push('name = ?'); vals.push(need(str(b.name, 80), 'Name the bill')); }
      if ('amount' in b) { const c = Math.round(Number(b.amount) * 100); if (!Number.isFinite(c) || c <= 0) throw new HttpError(400, 'Enter an amount above $0'); sets.push('amount_cents = ?'); vals.push(c); }
      if ('cadence' in b) { sets.push('cadence = ?'); vals.push(b.cadence === 'yearly' ? 'yearly' : 'monthly'); }
      if ('next_on' in b) { if (!DATE_RE.test(b.next_on || '')) throw new HttpError(400, 'Pick the next charge date'); sets.push('next_on = ?'); vals.push(b.next_on); }
      if ('project_id' in b) { sets.push('project_id = ?'); vals.push(str(b.project_id, 24) || null); }
      if (sets.length) await env.DB.prepare(`UPDATE recurring SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, Number(m[1])).run();
      await postRecurring(env);
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM recurring WHERE id = ?').bind(Number(m[1])).run();
      return json({ ok: true });
    }
  }
  if (method === 'POST' && path === '/renewals') return json(await createRenewal(env, await readJson(request)), 201);
  if (method === 'GET' && path === '/domains') return json(await domains(env));
  if ((m = path.match(/^\/renewals\/(\d+)\/renewed$/)) && method === 'POST') {
    const r = await env.DB.prepare('SELECT * FROM renewals WHERE id = ?').bind(Number(m[1])).first();
    if (!r) throw new HttpError(404, 'No such domain');
    await renewDomain(env, r, todayLocal(tzOf(env)));
    return json(await env.DB.prepare('SELECT * FROM renewals WHERE id = ?').bind(r.id).first());
  }
  if ((m = path.match(/^\/renewals\/(\d+)$/))) {
    if (method === 'PATCH') return json(await updateRenewal(env, Number(m[1]), await readJson(request)));
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM renewals WHERE id = ?').bind(Number(m[1])).run();
      return json({ ok: true });
    }
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
