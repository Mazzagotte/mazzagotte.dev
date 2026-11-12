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

// Marks a once-only job as done. Returns false if it already ran.
export async function claim(env, key) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO sent (key) VALUES (?)').bind(key).run();
  return r.meta.changes > 0;
}
