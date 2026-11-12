// Webhooks from outside: Railway (deploys, crashes), Cloudflare builds (deploy reports), and the
// Backend (Stripe money). These paths sit outside Cloudflare Access, so each one needs its own secret.
import { alert, logEvent } from './events.js';
import { DATE_RE, HttpError, json, readJson, safeEqual, str, todayLocal } from './util.js';

// Railway service id → hub project. The Backend and daily-report serve both apps, so they map to none.
const RAILWAY_SERVICES = {
  '6407b95d-64a0-4ef2-aeb1-4f95605b4c2a': 'tc',  // Tournament Central
  'e78e3284-b4a5-436e-9131-d12be437d409': 'bw',  // BracketWorks
};
const CRASH_LOOP = { count: 3, windowMs: 10 * 60_000 };

function requireSecret(request, expected) {
  if (!expected) throw new HttpError(503, 'Webhook secret not set');
  const auth = request.headers.get('authorization') || '';
  const given = request.headers.get('x-webhook-secret') || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!safeEqual(given, expected)) throw new HttpError(401, 'Bad secret');
}

async function projectExists(env, id) {
  if (!id) return null;
  const row = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
  return row ? row.id : null;
}

// ---------- Railway ----------
async function railway(request, env, ctx) {
  requireSecret(request, env.RAILWAY_HOOK_SECRET);
  const body = await readJson(request);
  const type = String(body.type || '');
  const res = body.resource || {};
  const service = (res.service && res.service.name) || 'A Railway service';
  const project = RAILWAY_SERVICES[res.service && res.service.id] || null;
  const d = body.details || {};
  const commit = d.commitMessage ? `: “${String(d.commitMessage).slice(0, 80)}”` : '';
  const state = type.split('.').pop().toLowerCase();

  if (state === 'failed') {
    await alert(env, ctx, { project, source: 'railway', title: `${service} deploy failed`, body: `Railway build or deploy failed${commit}`, tag: `deploy-${service}` });
  } else if (state === 'crashed' || state === 'oom_killed') {
    const what = state === 'oom_killed' ? 'ran out of memory' : 'crashed';
    await logEvent(env, { project, source: 'railway', level: 'warn', text: `${service} ${what} (Railway restarts it automatically)` });
    const since = Date.now() - CRASH_LOOP.windowMs;
    const { n } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM events WHERE source = 'railway' AND level = 'warn' AND text LIKE ? AND created_at > ?"
    ).bind(`${service} %`, since).first();
    if (n === CRASH_LOOP.count) {
      await alert(env, ctx, { project, source: 'railway', title: `${service} is crash-looping`, body: `${n} crashes in 10 minutes`, tag: `crash-${service}` });
      await env.DB.prepare('INSERT INTO incidents (project_id, source, title, detail, started_at) VALUES (?, ?, ?, ?, ?)')
        .bind(project, 'railway', `${service} crash loop`, `${n} crashes in 10 minutes`, Date.now()).run();
    }
  } else if (state === 'success' || state === 'deployed') {
    await logEvent(env, { project, source: 'railway', level: 'good', text: `${service} deployed${commit}` });
  }
  return json({ ok: true });
}

// ---------- Cloudflare builds (or anything else that deploys) ----------
// POST { "project": "usbc", "ok": true, "message": "optional", "commit": "optional" }
async function deploy(request, env, ctx) {
  requireSecret(request, env.DEPLOY_HOOK_SECRET);
  const body = await readJson(request);
  const project = await projectExists(env, str(body.project, 24));
  if (!project) throw new HttpError(400, 'Unknown project');
  const name = (await env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(project).first()).name;
  const note = str(body.message, 160) || str(body.commit, 40);
  if (body.ok === false) {
    await alert(env, ctx, { project, source: 'deploy', title: `${name} deploy failed`, body: note || 'The build reported a failure', tag: `deploy-${project}` });
  } else {
    await logEvent(env, { project, source: 'deploy', level: 'good', text: `${name} deployed${note ? ': ' + note : ''}` });
  }
  return json({ ok: true });
}

// ---------- Money (sent by the Backend after it verifies Stripe's signature) ----------
// POST { "type": "payment" | "refund" | "fee" | "dispute" | "payout", "amount_cents": 500,
//        "description": "Tournament fee: Spring Classic", "external_id": "pi_...", "project": "tc", "occurred_on": "2026-11-12" }
const MONEY_KINDS = { payment: 'income', refund: 'refund', fee: 'fee' };

async function money(request, env, ctx) {
  requireSecret(request, env.MONEY_HOOK_SECRET);
  const b = await readJson(request);
  const type = String(b.type || '');
  const cents = Number.parseInt(b.amount_cents, 10);
  const project = (await projectExists(env, str(b.project, 24))) || 'tc';
  const description = str(b.description, 200) || type;
  const fmt = `$${(Math.abs(cents || 0) / 100).toFixed(2)}`;

  if (type === 'dispute') {
    await alert(env, ctx, { project, source: 'money', title: 'Payment dispute opened', body: `${fmt} · ${description}`, url: '/#/finances', tag: 'dispute' });
    return json({ ok: true });
  }
  if (type === 'payout') {
    await logEvent(env, { project, source: 'money', level: 'good', text: `Payout of ${fmt} sent to your bank` });
    return json({ ok: true });
  }
  const kind = MONEY_KINDS[type];
  if (!kind) throw new HttpError(400, 'Unknown type');
  if (!Number.isFinite(cents) || cents < 0) throw new HttpError(400, 'amount_cents must be a positive whole number');
  const on = DATE_RE.test(b.occurred_on || '') ? b.occurred_on : todayLocal(env.TIMEZONE || 'America/Denver');

  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO ledger (project_id, kind, source, description, amount_cents, occurred_on, external_id, created_at)
     VALUES (?, ?, 'stripe', ?, ?, ?, ?, ?)`
  ).bind(project, kind, description, cents, on, str(b.external_id, 120), Date.now()).run();
  if (r.meta.changes && kind === 'income') {
    await logEvent(env, { project, source: 'money', level: 'good', text: `${fmt} in · ${description}` });
  } else if (r.meta.changes && kind === 'refund') {
    await logEvent(env, { project, source: 'money', level: 'warn', text: `${fmt} refunded · ${description}` });
  }
  return json({ ok: true, saved: !!r.meta.changes });
}

export async function handleHook(request, env, ctx) {
  if (request.method !== 'POST') throw new HttpError(405, 'POST only');
  const path = new URL(request.url).pathname;
  if (path === '/hooks/railway') return railway(request, env, ctx);
  if (path === '/hooks/deploy') return deploy(request, env, ctx);
  if (path === '/hooks/money') return money(request, env, ctx);
  throw new HttpError(404, 'No such hook');
}
