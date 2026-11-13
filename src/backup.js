// Nightly backups: a full copy of each database (tables + schema) as gzipped JSON in R2, kept 30 days.
import { alert, logEvent } from './events.js';
import { todayLocal } from './util.js';

const KEEP_DAYS = 30;
export const backupDbs = (env) => [['hub', 'mazzagotte.dev hub', env.DB], ['sparetime', 'SpareTime', env.SPARETIME_DB], ['usbc', 'Ada County USBC', env.USBC_DB]].filter(([, , db]) => db);

const b64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
const clean = (v) => (v instanceof ArrayBuffer ? { $b64: b64(v) } : Array.isArray(v) ? { $b64: b64(new Uint8Array(v).buffer) } : v);

async function dump(db) {
  const { results: schema } = await db.prepare(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name"
  ).all();
  const tables = {}; let rows = 0;
  for (const t of schema.filter((x) => x.type === 'table')) {
    const all = [];
    for (let off = 0; ; off += 1000) {
      const { results } = await db.prepare(`SELECT * FROM "${t.name.replace(/"/g, '""')}" LIMIT 1000 OFFSET ${off}`).all();
      for (const r of results) all.push(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, clean(v)])));
      if (results.length < 1000) break;
    }
    tables[t.name] = all; rows += all.length;
  }
  return { schema, tables, rows, table_count: Object.keys(tables).length };
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function runBackups(env, ctx) {
  if (!env.BACKUPS) return [{ db: 'all', ok: false, error: 'Backup storage is not connected' }];
  const date = todayLocal(env.TIMEZONE || 'America/Denver');
  const out = [];
  for (const [id, name, db] of backupDbs(env)) {
    try {
      const d = await dump(db);
      const body = JSON.stringify({ format: 'mazzagotte-backup/1', database: id, name, created_at: new Date().toISOString(), schema: d.schema, tables: d.tables });
      const gz = await gzip(body);
      const key = `${id}/${date}.json.gz`;
      await env.BACKUPS.put(key, gz, { httpMetadata: { contentType: 'application/gzip' }, customMetadata: { rows: String(d.rows), tables: String(d.table_count), name } });
      out.push({ db: id, ok: true, key, size: gz.length, rows: d.rows });
    } catch (e) {
      out.push({ db: id, ok: false, error: String(e && e.message || e) });
    }
  }
  // Keep the last 30 days.
  const cutoff = new Date(Date.parse(date + 'T12:00:00Z') - KEEP_DAYS * 86400_000).toISOString().slice(0, 10);
  for (const [id] of backupDbs(env)) {
    const list = await env.BACKUPS.list({ prefix: id + '/' });
    const old = list.objects.filter((o) => o.key.slice(id.length + 1, id.length + 11) < cutoff).map((o) => o.key);
    if (old.length) await env.BACKUPS.delete(old);
  }
  const failed = out.filter((r) => !r.ok);
  if (failed.length) await alert(env, ctx, { source: 'backup', title: 'Backup failed', body: failed.map((f) => `${f.db}: ${f.error}`).join('; '), url: '/#/monitoring', tag: 'backup' });
  else await logEvent(env, { source: 'backup', level: 'good', text: `Backed up ${out.length} databases (${out.reduce((a, r) => a + r.rows, 0)} rows)` });
  return out;
}

export async function listBackups(env) {
  if (!env.BACKUPS) return { connected: false, databases: [] };
  const databases = [];
  for (const [id, name] of backupDbs(env)) {
    const list = await env.BACKUPS.list({ prefix: id + '/', include: ['customMetadata'] });
    const files = list.objects.map((o) => ({ key: o.key, date: o.key.slice(id.length + 1, id.length + 11), size: o.size, uploaded: o.uploaded, rows: Number((o.customMetadata || {}).rows || 0) }))
      .sort((a, b) => b.date.localeCompare(a.date));
    databases.push({ id, name, files });
  }
  return { connected: true, keep_days: KEEP_DAYS, databases };
}
