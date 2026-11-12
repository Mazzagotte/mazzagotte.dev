// Uptime checks: the hub calls every enabled check, records the result, and opens or closes incidents.
// A site counts as down after FAILS_TO_ALERT failures in a row, so one blip doesn't wake you up.
import { alert } from './events.js';
import { minutesText } from './util.js';

const FAILS_TO_ALERT = 2;
const STILL_DOWN_EVERY_MS = 30 * 60_000;
const TIMEOUT_MS = 10_000;
const KEEP_DAYS = 95;

async function probe(check) {
  const started = Date.now();
  try {
    const res = await fetch(check.url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'mazzagotte.dev uptime check', 'cache-control': 'no-cache' },
      cf: { cacheTtl: 0 },
    });
    const ms = Date.now() - started;
    let ok = check.expect_status ? res.status === check.expect_status : res.status < 400;
    let error = ok ? null : `HTTP ${res.status}`;
    if (ok && check.expect_text) {
      const body = await res.text();
      if (!body.includes(check.expect_text)) { ok = false; error = 'Expected text missing'; }
    } else {
      res.body && res.body.cancel();
    }
    return { ok, status: res.status, ms, error };
  } catch (e) {
    const ms = Date.now() - started;
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    const msg = String((e && e.message) || e);
    const error = timedOut ? `No answer in ${TIMEOUT_MS / 1000} s` : /internal error|lookup|dns|connect/i.test(msg) ? 'Could not connect' : msg.slice(0, 200);
    return { ok: false, status: null, ms, error };
  }
}

export async function runChecks(env, ctx) {
  const { results: checks } = await env.DB.prepare(
    `SELECT c.*, p.name AS project_name, s.fails, s.incident_id
       FROM checks c JOIN projects p ON p.id = c.project_id
       LEFT JOIN check_state s ON s.check_id = c.id
      WHERE c.enabled = 1`
  ).all();
  const now = Date.now();
  const outcomes = await Promise.all(checks.map(async (c) => ({ c, r: await probe(c) })));

  const writes = [];
  for (const { c, r } of outcomes) {
    writes.push(env.DB.prepare('INSERT INTO check_results (check_id, ok, status, ms, error, at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(c.id, r.ok ? 1 : 0, r.status, r.ms, r.error, now));
  }
  if (writes.length) await env.DB.batch(writes);

  for (const { c, r } of outcomes) {
    const fails = r.ok ? 0 : (c.fails || 0) + 1;
    let incidentId = c.incident_id || null;
    const label = `${c.project_name} (${c.name})`;

    if (!r.ok && fails === FAILS_TO_ALERT && !incidentId) {
      const ins = await env.DB.prepare(
        'INSERT INTO incidents (project_id, check_id, source, title, detail, started_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(c.project_id, c.id, 'check', `${label} is down`, r.error || '', now).run();
      incidentId = ins.meta.last_row_id;
      await alert(env, ctx, { project: c.project_id, source: 'check', title: `${c.project_name} is down`, body: `${c.name}: ${r.error || 'failed'}`, tag: `down-${c.id}` });
    } else if (!r.ok && incidentId && fails > FAILS_TO_ALERT) {
      const inc = await env.DB.prepare('SELECT started_at FROM incidents WHERE id = ?').bind(incidentId).first();
      const downFor = inc ? now - inc.started_at : 0;
      // Remind every 30 minutes while it stays down.
      if (inc && Math.floor(downFor / STILL_DOWN_EVERY_MS) > Math.floor((downFor - 60_000) / STILL_DOWN_EVERY_MS)) {
        await alert(env, ctx, { project: c.project_id, source: 'check', title: `${c.project_name} is still down`, body: `Down for ${minutesText(downFor)}: ${r.error || 'failed'}`, tag: `down-${c.id}` });
      }
    } else if (r.ok && incidentId) {
      const inc = await env.DB.prepare('SELECT started_at FROM incidents WHERE id = ?').bind(incidentId).first();
      await env.DB.prepare('UPDATE incidents SET resolved_at = ? WHERE id = ?').bind(now, incidentId).run();
      const took = inc ? minutesText(now - inc.started_at) : 'a while';
      await alert(env, ctx, { project: c.project_id, source: 'check', level: 'good', title: `${c.project_name} is back up`, body: `${c.name} was down for ${took}`, tag: `down-${c.id}` });
      incidentId = null;
    }

    await env.DB.prepare(
      `INSERT INTO check_state (check_id, fails, last_at, last_ok, last_ms, last_status, last_error, incident_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (check_id) DO UPDATE SET fails = excluded.fails, last_at = excluded.last_at, last_ok = excluded.last_ok,
         last_ms = excluded.last_ms, last_status = excluded.last_status, last_error = excluded.last_error, incident_id = excluded.incident_id`
    ).bind(c.id, fails, now, r.ok ? 1 : 0, r.ms, r.status, r.error, incidentId).run();
  }
  return outcomes.map(({ c, r }) => ({ id: c.id, project: c.project_id, name: c.name, ...r }));
}

export async function pruneResults(env) {
  const cutoff = Date.now() - KEEP_DAYS * 86400_000;
  await env.DB.prepare('DELETE FROM check_results WHERE at < ?').bind(cutoff).run();
}
