// Turn a backup file into SQL you can run with `wrangler d1 execute <db> --remote --file restore.sql`.
// Usage: node scripts/restore.mjs hub-2026-11-12.json.gz > restore.sql
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/restore.mjs <backup.json.gz> > restore.sql'); process.exit(1); }
const data = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
const q = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && v.$b64) return `X'${Buffer.from(v.$b64, 'base64').toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const out = [`-- Restore of ${data.database} from ${data.created_at}`, 'PRAGMA defer_foreign_keys = ON;'];
for (const s of data.schema.filter((x) => x.type === 'table')) out.push(s.sql.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ') + ';');
for (const [table, rows] of Object.entries(data.tables)) {
  out.push(`DELETE FROM "${table}";`);
  for (const r of rows) out.push(`INSERT INTO "${table}" (${Object.keys(r).map((k) => `"${k}"`).join(', ')}) VALUES (${Object.values(r).map(q).join(', ')});`);
}
console.log(out.join('\n'));
