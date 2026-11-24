// The activity timeline + push alerts. Everything that happens goes through here.
import { pushAll } from './push.js';

export async function logEvent(env, { project = null, source = 'hub', level = 'info', text }) {
  await env.DB.prepare('INSERT INTO events (project_id, source, level, text, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(project, source, level, text, Date.now()).run();
}

// Logs the event and sends it to your phone.
export async function alert(env, ctx, { project = null, source, level = 'bad', title, body, url = '/#/monitoring', tag }) {
  await logEvent(env, { project, source, level, text: `${title}${body ? ' — ' + body : ''}` });
  const work = pushAll(env, { title, body: body || '', url, tag: tag || `${source}-${project || 'hub'}` });
  if (ctx && ctx.waitUntil) ctx.waitUntil(work);
  else await work;
}

// How long the hub keeps its own history, so the database can't grow forever.
// (Uptime history and backups have their own limits in checks.js and backup.js.)
const KEEP_EVENTS_DAYS = 365;     // activity timeline
const KEEP_INCIDENTS_DAYS = 365;  // resolved incidents only; an open incident is never deleted
const KEEP_SENT_DAYS = 30;        // once-only job keys are dated (e.g. todo-morning:2026-11-24), so old ones do nothing

export async function pruneHistory(env) {
  const now = Date.now();
  const day = 86400_000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events WHERE created_at < ?').bind(now - KEEP_EVENTS_DAYS * day),
    env.DB.prepare('DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < ?').bind(now - KEEP_INCIDENTS_DAYS * day),
    // Keys end in a YYYY-MM-DD date; anything without one is left alone.
    env.DB.prepare("DELETE FROM sent WHERE substr(key, -10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(key, -10) < ?")
      .bind(new Date(now - KEEP_SENT_DAYS * day).toISOString().slice(0, 10)),
  ]);
}

// Marks a once-only job as done. Returns false if it already ran.
export async function claim(env, key) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO sent (key) VALUES (?)').bind(key).run();
  return r.meta.changes > 0;
}
