// mazzagotte.dev hub — the app (no build step). Hash routes: #/ · #/projects · #/p/<id> · #/monitoring · #/finances
import { LUCIDE } from './lucide.js';
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
// Key hints match the computer: ⌘ on Mac, Ctrl everywhere else.
const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
const MOD = MAC ? '⌘' : 'Ctrl';

// ---------- state ----------
const S = {
  projects: [],
  collapsed: localStorage.getItem('side') === 'collapsed',
  filter: 'all',
  tab: 'notes',
  kind: 'note',
  period: 'month',
  fin: { kind: 'all', site: '', q: '', limit: 50 },
  palette: null, // { mode: 'search' | 'note', q, sel, project, kindForNote }
  data: null,
  undo: null,
  showForm: null,
};

// ---------- helpers ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function rel(ms) {
  if (!ms) return 'never';
  const d = Date.now() - ms;
  if (d < 60_000) return 'just now';
  if (d < 3600_000) return `${Math.round(d / 60_000)} min ago`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = new Date(ms);
  if (t >= today) return `${Math.round(d / 3600_000)} h ago`;
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (t >= y) return 'Yesterday';
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
const money = (cents, whole) => (cents < 0 ? '−' : '') + '$' + (Math.abs(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
const dateLabel = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
const KIND_LABEL = { note: 'Note', todo: 'To do', idea: 'Idea', rule: 'Rule', infra: 'Infra' };
const STATUS_LABEL = { live: 'Live', progress: 'In progress', planned: 'Planned' };
const COLORS = ['#2563EB', '#C2410C', '#0F766E', '#4F46E5', '#15803D', '#D97706', '#E11D48', '#7C3AED', '#0891B2', '#52525B'];

// Lucide icon by name. Size in px; stroke follows the text color.
const L = (name, size = 18, cls = '') => `<svg class="lu ${cls}" aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${LUCIDE[name] || ''}</svg>`;
const ICON = {
  dash: L('layout-dashboard'), folder: L('folder'), money: L('wallet'), gauge: L('activity'), panel: L('panel-left'),
  search: L('search', 16), plus: L('plus', 16), sun: L('sun'), moon: L('moon'), pin: L('pin', 16), trash: L('trash-2', 16),
  check: L('circle-check', 22), x: L('x', 16), out: L('arrow-up-right', 13), refresh: L('refresh-cw', 16), bell: L('bell', 16),
  todo: L('square-check-big'), edit: L('pencil', 16), emptyNote: L('notebook-pen', 36), keys: L('keyboard'),
};
// Card heading with a small icon in front.
const H = (id, icon, text) => `<h2 id="${id}" class="ih">${L(icon, 16)}${text}</h2>`;
const KIND_ICON = { note: 'sticky-note', todo: 'square-check-big', idea: 'lightbulb', rule: 'scale', infra: 'server' };
const kindTag = (k) => `<span class="tag k-${k}">${L(KIND_ICON[k] || 'sticky-note', 12)}${KIND_LABEL[k] || k}</span>`;

// Notes: links become clickable, **bold** and `code` render.
function fmt(text) {
  return esc(text)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, '')}</a>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
}

// Response time over the last 24 hours as a tiny line; failed hours show as red marks.
function spark(points, { w = 96, h = 26 } = {}) {
  const vals = points.map((p) => (p && p.ms != null ? p.ms : null));
  const have = vals.filter((v) => v != null);
  if (have.length < 2) return `<svg class="spark" width="${w}" height="${h}" aria-hidden="true"><line x1="0" y1="${h - 1}" x2="${w}" y2="${h - 1}" stroke="var(--border2)" stroke-dasharray="2 3"/></svg>`;
  const max = Math.max(...have) * 1.1, min = Math.min(...have) * 0.9;
  const x = (i) => (i / (points.length - 1)) * (w - 4) + 2;
  const y = (v) => h - 3 - ((v - min) / Math.max(1, max - min)) * (h - 6);
  let d = '', pen = false;
  vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
  const lastI = vals.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop();
  const fails = points.map((p, i) => (p && !p.ok ? `<rect x="${(x(i) - 1.5).toFixed(1)}" y="${h - 4}" width="3" height="4" rx="1" fill="var(--bad)"/>` : '')).join('');
  const area = `${d}L${x(lastI).toFixed(1)},${h}L${x(vals.findIndex((v) => v != null)).toFixed(1)},${h}Z`;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${area}" fill="currentColor" opacity=".08"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>${fails}</svg>`;
}

const tile = (p, cls = '') => `<span class="tile ${cls}" aria-hidden="true" style="background:${esc(p.color)};color:${esc(p.ink || '#fff')}">${esc(p.initials)}</span>`;
const pill = (status) => `<span class="pill ${esc(status)}">${STATUS_LABEL[status] || esc(status)}</span>`;

// ---------- toast ----------
let toastTimer;
function toast(msg, { undo, error } = {}) {
  clearTimeout(toastTimer);
  S.undo = undo || null;
  $('#toast').innerHTML = `<div class="toast${error ? ' err' : ''}">${error ? L('circle-alert', 18) : `<span style="color:#22C55E;display:inline-flex">${L('circle-check', 18)}</span>`}<span>${esc(msg)}</span>${undo ? '<button data-act="undo">Undo</button>' : ''}</div>`;
  toastTimer = setTimeout(() => { $('#toast').innerHTML = ''; S.undo = null; }, error ? 6000 : 5000);
}
const fail = (e) => toast(e.message || 'Something went wrong', { error: true });

// ---------- theme ----------
function setTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#09090B' : '#F7F7F8');
}
const isDark = () => document.documentElement.classList.contains('dark');


// ---------- routing ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [view, id] = h.split('/');
  if (view === 'p' && id) return { view: 'project', id };
  if (view === 'finances' && id === 'domains') return { view: 'domains' };
  if (view === 'finances' && id) return { view: 'finances', id };
  if (['projects', 'monitoring', 'finances'].includes(view)) return { view };
  return { view: 'dashboard' };
}

async function loadProjects() {
  S.projects = (await api('/projects')).projects;
}

async function render({ quiet } = {}) {
  const r = route();
  try {
    if (!S.projects.length) await loadProjects();
    if (r.view === 'dashboard') S.data = await api('/dashboard');
    else if (r.view === 'project') S.data = await api('/projects/' + encodeURIComponent(r.id));
    else if (r.view === 'monitoring') S.data = await api('/monitoring');
    else if (r.view === 'domains') S.data = await api('/domains');
    else if (r.view === 'finances') S.fin.site = r.id || '', S.data = await api('/finances?' + new URLSearchParams({ period: S.period, kind: S.fin.kind === 'all' ? '' : S.fin.kind, site: S.fin.site, q: S.fin.q, limit: S.fin.limit }));
    else S.data = await api('/dashboard');
  } catch (e) {
    app.innerHTML = shell(r, `<div class="page"><div class="empty big"><b>Couldn't load this page</b><span>${esc(e.message)}</span><button class="btn" data-act="reload">Try again</button></div></div>`, 'Error');
    return;
  }
  const views = { dashboard: viewDashboard, projects: viewProjects, project: viewProject, monitoring: viewMonitoring, finances: viewFinances, domains: viewDomains };
  const { crumb, html } = views[r.view](S.data, r);
  S.loadedAt = Date.now();
  const y = window.scrollY;
  const swap = () => {
    app.classList.toggle('quiet', !!quiet);
    app.innerHTML = shell(r, html, crumb);
    if (quiet) window.scrollTo(0, y); else window.scrollTo(0, 0);
  };
  // Smooth cross-fade between pages where the browser supports it.
  if (!quiet && S.booted && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(swap);
  else swap();
  S.booted = true;
  document.title = `${crumb} · mazzagotte.dev`;
}

// ---------- shell ----------
function shell(r, content, crumb) {
  const on = (v) => (r.view === v ? ' on' : '');
  const todoCount = S.data && S.data.todos ? S.data.todos.filter((t) => !t.done).length : '';
  return `
<div class="shell">
  <aside class="side${S.collapsed ? ' collapsed' : ''}">
    <div class="row" style="justify-content:space-between">
      <a class="brand" href="#/" aria-label="mazzagotte.dev home"><span class="mark">M</span><span class="lbl mono" style="font-weight:500;font-size:14px">mazzagotte.dev</span></a>
      <button class="icon-btn lbl" data-act="side" aria-label="Collapse sidebar">${ICON.panel}</button>
    </div>
    ${S.collapsed ? `<button class="icon-btn" style="align-self:center;border:1px solid var(--border)" data-act="side" aria-label="Expand sidebar">${ICON.panel}</button>` : ''}
    <nav aria-label="Main" style="display:flex;flex-direction:column;gap:2px">
      <a class="nav${on('dashboard')}" href="#/" aria-label="Dashboard">${ICON.dash}<span class="lbl">Dashboard</span></a>
      <a class="nav${on('projects')}" href="#/projects" aria-label="Projects">${ICON.folder}<span class="lbl">Projects</span></a>
      <a class="nav${on('monitoring')}" href="#/monitoring" aria-label="Monitoring">${ICON.gauge}<span class="lbl">Monitoring</span></a>
      <a class="nav${on('finances') || on('domains')}" href="#/finances" aria-label="Finances">${ICON.money}<span class="lbl">Finances</span></a>
    </nav>
    <div style="display:flex;flex-direction:column;gap:2px">
      <p class="sec">Projects</p>
      ${S.projects.map((p) => `<a class="nav${r.view === 'project' && r.id === p.id ? ' on' : ''}" href="#/p/${esc(p.id)}" aria-label="${esc(p.name)}"><span class="dotwrap"><span class="dot" style="background:${esc(p.color)}"></span></span><span class="lbl" style="overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span></a>`).join('')}
      <button class="nav" data-act="new-project" aria-label="Add project">${ICON.plus}<span class="lbl">Add project</span></button>
    </div>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:2px">
      <button class="nav" data-act="shortcuts" aria-label="Keyboard shortcuts">${ICON.keys}<span class="lbl">Shortcuts</span><span class="kbd lbl" style="margin-left:auto">?</span></button>
      <button class="nav" data-act="theme" aria-label="${isDark() ? 'Switch to light mode' : 'Switch to dark mode'}">${isDark() ? ICON.sun : ICON.moon}<span class="lbl">${isDark() ? 'Light mode' : 'Dark mode'}</span></button>
    </div>
  </aside>
  <div class="main">
    <header class="top"><div class="top-in">
      <p class="crumb"><span class="ws">Workspace / </span><b>${esc(crumb)}</b></p>
      <div class="top-actions">
        <span class="live d-only" title="This page refreshes on its own"><span class="sdot pulse"></span><span id="live-t">Live</span></span>
        <button class="search-btn" data-act="palette" aria-label="Search or jump to (${MAC ? 'Command' : 'Control'} K)">${ICON.search}<span class="grow">Search or jump to…</span><span class="kbd hide-sm">${MOD} K</span></button>
        <button class="btn primary d-only" data-act="new-note">${ICON.plus}<span>New note</span><span class="kbd">N</span></button>
      </div>
    </div></header>
    ${content}
  </div>
</div>
<nav class="tabbar" aria-label="Tabs">
  <a href="#/" class="${on('dashboard').trim()}">${ICON.dash}Home</a>
  <a href="#/projects" class="${on('projects').trim()}">${ICON.folder}Projects</a>
  <div class="plus"><button data-act="new-note" aria-label="New note">${L('plus', 24)}</button></div>
  <a href="#/monitoring" class="${on('monitoring').trim()}">${ICON.gauge}Status</a>
  <a href="#/finances" class="${(on('finances') || on('domains')).trim()}">${ICON.money}Money</a>
</nav>`;
}

// ---------- dashboard ----------
function projectCard(p) {
  const latest = p.latest
    ? `<div class="well"><p class="label">Latest note · ${esc(rel(p.latest.updated_at || p.latest.created_at))}</p><p class="fmt" style="font-size:14px;color:var(--text2)">${fmt(p.latest.text)}</p></div>`
    : `<div class="empty"><span style="color:var(--muted)">${ICON.emptyNote}</span><span style="display:flex;flex-direction:column;gap:2px"><b style="font-weight:500;color:var(--text2)">Nothing written yet</b><a href="#/p/${esc(p.id)}">Write the first note →</a></span></div>`;
  return `<article class="card stripe rise" style="--c:${esc(p.color)};display:flex;flex-direction:column;gap:14px;padding-top:24px">
    <div class="row" style="align-items:flex-start">${tile(p)}<div style="flex:1;min-width:0"><h3 style="margin:0;font-size:16px;font-weight:600"><a href="#/p/${esc(p.id)}" style="color:inherit">${esc(p.name)}</a></h3><p class="muted" style="margin:2px 0 0;font-size:13px">${esc(p.type)}</p></div>${pill(p.status)}</div>
    <p style="margin:0;font-size:14px;color:var(--body)">${esc(p.description)}</p>
    ${latest}
    <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:auto">${(p.links || []).slice(0, 3).map((l) => `<a class="chip" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ${ICON.out}</a>`).join('')}<a href="#/p/${esc(p.id)}" style="margin-left:auto;font-weight:500;font-size:14px">Open →</a></div>
  </article>`;
}

const projectRow = (p) => `<a class="prow" href="#/p/${esc(p.id)}">${tile(p)}<span class="grow"><b>${esc(p.name)}</b><span>${p.latest ? esc(p.latest.text) : esc(p.type)}</span></span>${pill(p.status)}<span class="chev">${L('chevron-right', 16)}</span></a>`;

function viewDashboard(d) {
  const f = d.projects.find((p) => p.id === d.featured) || d.projects[0];
  const enabled = d.checks.filter((c) => c.enabled);
  const known = enabled.filter((c) => c.last_at);
  const down = known.filter((c) => !c.last_ok);
  const projectName = Object.fromEntries(d.projects.map((p) => [p.id, p]));
  const allLinks = d.projects.flatMap((p) => (p.links || []).filter((l) => /^Site|Review|Display/.test(l.label)).map((l) => ({ ...l, color: p.color, name: p.name }))).slice(0, 7);
  const m = d.money;
  const filters = [['all', 'All'], ['live', 'Live'], ['progress', 'In progress'], ['planned', 'Planned']];
  const shown = d.projects.filter((p) => S.filter === 'all' || p.status === S.filter);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const live = d.projects.filter((p) => p.status === 'live').length;
  const openTodos = d.todos.filter((t) => !t.done).length;
  const featuredNote = f && f.latest;

  const html = `<div class="page">
  <div class="page-head rise"><div><p class="muted" style="margin:0 0 4px;font-size:14px">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p><h1>${greet}, <span class="grad">James</span></h1></div>
    <p class="muted" style="margin:0;font-size:14px">${d.projects.length} projects · ${live} live · ${openTodos} open to-dos</p></div>
  <div class="hscroll m-flex" style="margin:0 -16px 12px;padding:0 16px" aria-label="Site status">${enabled.map((c) => { const p = projectName[c.project_id] || {}; return `<a class="status-chip" href="#/monitoring"><span class="sdot ${!c.last_at ? 'unk' : c.last_ok ? 'glow' : 'bad'}"></span>${esc(p.name || c.project_id)}</a>`; }).join('')}</div>
  <div class="bento">
    ${f ? `<article class="card stripe span4 rows2 rise o2 feat" style="--c:${esc(f.color)};padding:28px;display:flex;flex-direction:column;gap:18px">
      <div class="row" style="align-items:flex-start;gap:14px">${tile(f, 'lg')}<div style="flex:1;min-width:0"><p class="muted" style="margin:0;font-size:12px;font-weight:500;letter-spacing:.04em;text-transform:uppercase">Most recent${featuredNote ? ' · ' + esc(rel(featuredNote.updated_at)) : ''}</p><h2 style="margin:2px 0 0;font-size:26px;font-weight:600;letter-spacing:-.02em">${esc(f.name)}</h2></div>${pill(f.status)}</div>
      <p class="d-only" style="margin:0;font-size:16px;color:var(--body)">${esc(f.description)}</p>
      ${featuredNote ? `<div class="well"><p class="label">Latest note</p><p class="fmt" style="font-size:15px;color:var(--text2)">${fmt(featuredNote.text)}</p></div>` : `<div class="empty"><span>${ICON.emptyNote}</span><span style="display:flex;flex-direction:column;gap:2px"><b style="font-weight:500;color:var(--text2)">No notes yet</b><a href="#/p/${esc(f.id)}">Write the first one →</a></span></div>`}
      <div class="d-only" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px">
        <div class="stat"><b>${f.open_todos}</b><span>${L('list-todo', 14)}Open to-dos</span></div>
        <div class="stat"><b>${(f.links || []).length}</b><span>${L('link', 14)}Links</span></div>
        <div class="stat"><b>${esc(f.hosting || '—')}</b><span>${L('server', 14)}Hosting</span></div>
      </div>
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:auto">${(f.links || []).slice(0, 3).map((l) => `<a class="chip" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ${ICON.out}</a>`).join('')}<a class="btn dark" style="margin-left:auto" href="#/p/${esc(f.id)}">Open project ${L('arrow-right', 15)}</a></div>
    </article>` : ''}
    <section class="card span2 rows2 rise o3" aria-labelledby="act-h"><div class="card-head">${H('act-h', 'history', 'Latest activity')}<span class="muted">Newest first</span></div>
      <ol class="feed">${d.events.map((e, i) => `<li><span class="ring${i === 0 ? ' fill' : ''}" style="--c:${esc(e.color || (e.level === 'bad' ? 'var(--bad)' : 'var(--hover)'))}"></span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span class="who"><b>${esc(e.project_name || 'Hub')}</b><span class="muted" style="flex:none;font-size:12px">${esc(rel(e.created_at))}</span></span><span class="what">${esc(e.text)}</span></span></li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ol>
    </section>
    <section class="card span3 rise d-only" aria-labelledby="st-h">
      <div class="card-head">${H('st-h', 'activity', 'Site status')}<span class="row" style="gap:12px;font-size:12px">${known.length ? (down.length ? `<span class="row" style="gap:6px;color:var(--bad);font-weight:500"><span class="sdot bad"></span>${down.length} down</span>` : '<span class="row" style="gap:6px;font-weight:500"><span class="sdot glow"></span>All up</span>') : '<span class="muted">Waiting for first check</span>'}<a href="#/monitoring" style="font-size:13px">Monitoring →</a></span></div>
      <div class="rows">${enabled.map((c) => { const p = projectName[c.project_id] || {}; return `<a href="#/monitoring" class="row" style="padding:9px 0;color:var(--text)"><span class="sdot ${!c.last_at ? 'unk' : c.last_ok ? '' : 'bad'}"></span><span style="flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3"><span style="font-size:14px;font-weight:500">${esc(p.name || c.project_id)}</span><span class="mono muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(host(c.url))}</span></span><span class="spk ${c.last_at && !c.last_ok ? 'down' : ''}">${spark(c.spark || [], { w: 72, h: 22 })}</span><span class="muted num" style="font-size:12px;min-width:64px;text-align:right">${c.last_at ? (c.last_ok ? `${c.last_ms} ms` : esc(c.last_error || 'Down')) : '—'}</span></a>`; }).join('')}</div>
    </section>
    <section class="card span3 rise o4" aria-labelledby="mo-h" style="display:flex;flex-direction:column;gap:14px">
      <div class="card-head" style="margin:0">${H('mo-h', 'wallet', 'Money · this month')}<a href="#/finances" style="font-size:13px">Finances →</a></div>
      ${m.income || m.costs ? `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
        <div class="stat"><span>${L('trending-up', 14)}Income</span><b style="font-size:22px">${money(m.income)}</b></div>
        <div class="stat"><span>${L('trending-down', 14)}Costs</span><b style="font-size:22px">${money(m.costs)}</b></div>
        <div class="stat"><span>${L('scale', 14)}Net</span><b style="font-size:22px">${money(m.net)}</b></div></div>`
        : `<div class="empty">Nothing recorded this month. Tournament Central's $5 charges land here automatically once payments are on; add costs on the Finances page.</div>`}
      ${d.renewal ? `<p class="muted" style="margin:0;font-size:13px">Next renewal: <span class="mono" style="color:var(--text2)">${esc(d.renewal.domain)}</span> · ${esc(dateLabel(d.renewal.renews_on))}</p>` : ''}
    </section>
    <section class="card span3 rise o1" aria-labelledby="td-h"><div class="card-head">${H('td-h', 'list-todo', 'To do')}<span class="muted">${openTodos} open</span></div>
      ${d.todos.map((t) => todoRow(t, true)).join('') || '<p class="muted" style="margin:8px 0 0;font-size:14px">No to-dos. Add one with a note tagged “To do”.</p>'}
    </section>
    <section class="card span3 rise d-only" aria-labelledby="ql-h"><div class="card-head">${H('ql-h', 'link', 'Quick links')}</div>
      ${allLinks.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener" class="row" style="min-height:40px;border-top:1px solid var(--border);color:var(--text2);font-size:14px;gap:10px"><span class="dot" style="width:8px;height:8px;border-radius:2px;background:${esc(l.color)}"></span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(host(l.url))}</span><span class="muted">${L('arrow-up-right', 14)}</span></a>`).join('')}
    </section>
  </div>
  <section style="margin-top:44px" aria-labelledby="ap-h">
    <div class="row" style="flex-wrap:wrap;justify-content:space-between;margin-bottom:16px"><h2 id="ap-h" style="margin:0;font-size:20px;font-weight:600;letter-spacing:-.02em">All projects</h2>
      <div class="row hscroll" role="group" aria-label="Filter by status" style="gap:6px">${filters.map(([k, l]) => `<button class="filter${S.filter === k ? ' on' : ''}" aria-pressed="${S.filter === k}" data-act="filter" data-v="${k}">${l}</button>`).join('')}</div></div>
    <div class="grid d-only">${shown.map(projectCard).join('')}</div>
    <div class="m-only"><div style="display:flex;flex-direction:column;gap:10px">${shown.map(projectRow).join('')}</div></div>
  </section>
</div>`;
  return { crumb: 'Dashboard', html };
}

function todoRow(t, withProject) {
  return `<div class="todo${t.done ? ' done' : ''}"><input type="checkbox" id="td-${t.id}" data-act="todo" data-id="${t.id}" ${t.done ? 'checked' : ''}><label for="td-${t.id}"><span class="t">${esc(t.text)}</span>${withProject ? `<span class="p"><span class="dot" style="width:8px;height:8px;border-radius:2px;background:${esc(t.color)}"></span>${esc(t.project_name)}</span>` : ''}</label></div>`;
}

// ---------- projects list ----------
function viewProjects(d) {
  return {
    crumb: 'Projects',
    html: `<div class="page"><div class="page-head"><div><h1 class="d-only">Projects</h1><p>Everything you're building, with its notes and links.</p></div><button class="btn" data-act="new-project">${ICON.plus}Add project</button></div>
      <div class="grid d-only">${d.projects.map(projectCard).join('')}</div>
      <div class="m-only"><div style="display:flex;flex-direction:column;gap:10px">${d.projects.map(projectRow).join('')}</div></div></div>`,
  };
}

// ---------- project ----------
function viewProject(d) {
  const p = d.project;
  const notes = d.notes;
  const open = notes.filter((n) => n.kind === 'todo' && !n.done);
  const kinds = ['note', 'todo', 'idea', 'rule', 'infra'];
  const checks = d.checks.filter((c) => c.enabled);
  const html = `<div class="page">
  <div class="card stripe rise proj-head" style="--c:${esc(p.color)};padding:28px;margin-bottom:20px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:20px">
    <div class="row" style="align-items:flex-start;gap:16px;min-width:0">${tile(p, 'lg')}<div style="min-width:0">
      <div class="row" style="flex-wrap:wrap;gap:10px"><h1 style="margin:0;font-size:30px;line-height:1.15;font-weight:600;letter-spacing:-.03em">${esc(p.name)}</h1>${pill(p.status)}</div>
      <p class="muted" style="margin:6px 0 0;max-width:620px">${esc(p.description)}</p>
      <p class="muted" style="margin:10px 0 0;font-size:13px;display:flex;flex-wrap:wrap;gap:6px 16px">${p.type ? `<span>${esc(p.type)}</span>` : ''}${p.hosting ? `<span>${esc(p.hosting)}</span>` : ''}${checks.map((c) => `<span class="row" style="gap:6px"><span class="sdot ${!c.last_at ? 'unk' : c.last_ok ? '' : 'bad'}"></span>${esc(c.name)} ${c.last_at ? (c.last_ok ? 'up' : 'down') : ''}</span>`).join('')}</p>
    </div></div>
    <div class="row acts" style="gap:10px;flex-wrap:wrap;align-items:flex-start"><button class="btn" data-act="edit-project">${L('pencil', 15)}Edit project</button>${p.status !== 'planned' && d.links[0] ? `<a class="btn primary" href="${esc(d.links[0].url)}" target="_blank" rel="noopener">Open ${esc(d.links[0].label.toLowerCase())} ${L('arrow-up-right', 15)}</a>` : ''}</div>
  </div>
  <section aria-label="Quick links" class="rise qlinks" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-bottom:32px">
    ${d.links.map((l) => `<a class="qlink" href="${esc(l.url)}" target="_blank" rel="noopener"><span class="l">${esc(l.label)}</span><span class="u">${esc(host(l.url))} ${L('arrow-up-right', 13)}</span></a>`).join('')}
    <button class="qlink add" data-act="add-link">+ Add link</button>
  </section>
  ${S.showForm === 'link' ? `<form class="card rise" data-form="link" style="margin:-16px 0 24px;display:flex;flex-direction:column;gap:12px"><div class="form-row"><label class="field"><span>Name</span><input class="input" name="label" required maxlength="40" placeholder="Admin dashboard"></label><label class="field" style="flex:2 1 280px"><span>Web address</span><input class="input" name="url" type="url" required placeholder="https://"></label></div><div class="row" style="justify-content:flex-end;gap:10px"><button type="button" class="btn" data-act="cancel-form">Cancel</button><button class="btn primary">Save link</button></div></form>` : ''}
  <div class="split">
    <section class="wide" aria-label="Notes">
      <div class="tabs" role="tablist"><button class="tab${S.tab === 'notes' ? ' on' : ''}" role="tab" aria-selected="${S.tab === 'notes'}" data-act="tab" data-v="notes">Notes <span class="count-pill">${notes.length}</span></button><button class="tab${S.tab === 'links' ? ' on' : ''}" role="tab" aria-selected="${S.tab === 'links'}" data-act="tab" data-v="links">All links <span class="count-pill">${d.links.length}</span></button></div>
      ${S.tab === 'notes' ? `
      <form class="card" data-form="note" style="padding:14px;margin-bottom:16px">
        <label class="sr" for="note-text">New note</label>
        <textarea class="input" id="note-text" name="text" rows="3" placeholder="Write a note — a to-do, an idea, where you left off…" required maxlength="2000"></textarea>
        <div class="row composer-foot" style="flex-wrap:wrap;justify-content:space-between;margin-top:10px;gap:10px">
          <div class="row kinds" role="group" aria-label="Note type" style="gap:6px;flex-wrap:wrap">${kinds.map((k) => `<button type="button" class="kind" aria-pressed="${S.kind === k}" data-act="kind" data-v="${k}">${L(KIND_ICON[k], 14)}${KIND_LABEL[k]}</button>`).join('')}</div>
          <button class="btn primary">Add note <span class="kbd">${MOD} ↵</span></button>
        </div>
      </form>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${notes.map((n) => `<article class="note-card rise${n.kind === 'todo' && n.done ? ' done' : ''}">
          <div style="flex:1;min-width:0"><div class="meta">${kindTag(n.kind)}${n.pinned ? '<span style="font-weight:500;color:var(--body)">Pinned</span>' : ''}<span>· ${esc(rel(n.created_at))}</span>${n.kind === 'todo' ? `<label class="row" style="gap:6px;margin-left:auto;cursor:pointer"><input type="checkbox" data-act="todo" data-id="${n.id}" ${n.done ? 'checked' : ''} style="accent-color:var(--accent)"> Done</label>` : ''}</div>${S.editing === n.id ? `<form data-form="edit-note" data-id="${n.id}" class="edit-note"><label class="sr" for="en-${n.id}">Edit note</label><textarea class="input" id="en-${n.id}" name="text" rows="3" required maxlength="2000">${esc(n.text)}</textarea><div class="row" style="justify-content:flex-end;gap:8px;margin-top:8px"><button type="button" class="btn small" data-act="cancel-edit">Cancel</button><button class="btn small primary">Save <span class="kbd">${MOD} ↵</span></button></div></form>` : `<p class="fmt" data-act="edit-note" data-id="${n.id}" title="Click to edit">${fmt(n.text)}</p>`}</div>
          <div class="acts"><button class="icon-btn" data-act="edit-note" data-id="${n.id}" aria-label="Edit note" title="Edit">${ICON.edit}</button><button class="icon-btn${n.pinned ? ' pinned-on' : ''}" data-act="pin" data-id="${n.id}" data-v="${n.pinned ? 0 : 1}" aria-pressed="${!!n.pinned}" aria-label="${n.pinned ? 'Unpin note' : 'Pin note'}" title="${n.pinned ? 'Unpin' : 'Pin'}">${ICON.pin}</button><button class="icon-btn" data-act="del-note" data-id="${n.id}" aria-label="Delete note" title="Delete">${ICON.trash}</button></div>
        </article>`).join('') || `<div class="empty big">${ICON.emptyNote}<b style="color:var(--text)">A clean slate</b><span>Jot down where you left off, a bug to fix, or an idea.</span></div>`}
      </div>` : `
      <div class="card" style="padding:0;overflow:hidden">${d.links.map((l) => `<div class="row" style="padding:14px 18px;border-bottom:1px solid var(--border)"><div style="flex:1;min-width:0"><p style="margin:0;font-weight:500;font-size:14px">${esc(l.label)}</p><p class="mono muted" style="margin:2px 0 0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.url)}</p></div><a href="${esc(l.url)}" target="_blank" rel="noopener" style="font-weight:500;font-size:14px">Open ↗</a><button class="icon-btn" data-act="del-link" data-id="${l.id}" aria-label="Delete link ${esc(l.label)}">${ICON.trash}</button></div>`).join('')}
        <div style="padding:14px 18px"><button class="btn small" data-act="add-link">+ Add a link</button></div></div>`}
    </section>
    <aside class="narrow">
      <div class="card"><h2 class="ih" style="margin-bottom:4px">${L('list-todo', 16)}Open to-dos</h2><p class="muted" style="margin:0 0 6px;font-size:13px">From this project's “To do” notes</p>${open.map((t) => `<p style="margin:0;padding:10px 0;border-top:1px solid var(--border);font-size:14px;color:var(--text2)">${esc(t.text)}</p>`).join('') || '<p class="muted" style="margin:0;padding:10px 0;border-top:1px solid var(--border);font-size:14px">All clear.</p>'}</div>
      <div class="card"><h2 class="ih" style="margin-bottom:8px">${L('history', 16)}Activity</h2>${d.events.map((e) => `<p style="margin:0;padding:8px 0;border-top:1px solid var(--border);font-size:13px;color:var(--text2);display:flex;justify-content:space-between;gap:10px"><span style="min-width:0;overflow-wrap:anywhere">${esc(e.text)}</span><span class="muted" style="flex:none">${esc(rel(e.created_at))}</span></p>`).join('') || '<p class="muted" style="margin:0;font-size:13px">Nothing yet.</p>'}</div>
      ${d.incidents.length ? `<div class="card"><h2 class="ih" style="margin-bottom:8px">${L('circle-alert', 16)}Incidents</h2>${d.incidents.map((i) => `<p style="margin:0;padding:8px 0;border-top:1px solid var(--border);font-size:13px"><span class="pill ${i.resolved_at ? 'up' : 'down'}" style="margin-right:6px">${i.resolved_at ? 'Resolved' : 'Open'}</span>${esc(i.title)} · <span class="muted">${esc(rel(i.started_at))}</span></p>`).join('')}</div>` : ''}
    </aside>
  </div>
</div>`;
  return { crumb: p.name, html };
}

// ---------- monitoring ----------
function viewMonitoring(d) {
  const proj = Object.fromEntries(d.projects.map((p) => [p.id, p]));
  const enabled = d.checks.filter((c) => c.enabled);
  const down = enabled.filter((c) => c.last_at && !c.last_ok);
  const waiting = enabled.filter((c) => !c.last_at).length;
  const lastAt = Math.max(0, ...enabled.map((c) => c.last_at || 0));
  const days = [];
  for (let i = 89; i >= 0; i--) { const t = new Date(d.today + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - i); days.push(t.toISOString().slice(0, 10)); }
  const openInc = d.incidents.filter((i) => !i.resolved_at).length;
  const strip = (c) => days.map((day) => {
    const x = c.days[day];
    const cls = !x ? 'none' : x.ok === x.total ? '' : x.ok === 0 ? 'bad' : 'part';
    const label = x ? `${dateLabel(day)} · ${x.ok}/${x.total} checks passed${x.ms ? ` · ${Math.round(x.ms)} ms avg` : ''}` : `${dateLabel(day)} · no data`;
    return `<span class="${cls}" title="${esc(label)}"></span>`;
  }).join('');
  const html = `<div class="page">
  <div class="page-head rise"><div><h1 class="d-only">Monitoring</h1><p>Uptime, crashes, slow pages, and failed deploys for every site.</p></div>
    <div class="row" style="gap:12px;flex-wrap:wrap"><span class="muted" style="font-size:13px">Last checked ${esc(rel(lastAt))}</span><button class="btn primary" data-act="run-checks">${ICON.refresh}Run checks now</button></div></div>
  <section class="card banner rise" aria-label="Overall status" style="margin-bottom:16px">
    <span class="badge${down.length ? ' bad' : waiting === enabled.length ? ' wait' : ''}" aria-hidden="true">${down.length ? L('circle-alert', 22) : waiting === enabled.length ? L('clock', 22) : ICON.check}</span>
    <div style="flex:1;min-width:0"><p style="margin:0;font-size:18px;font-weight:600">${down.length ? `${down.length} ${down.length === 1 ? 'site is' : 'sites are'} down` : waiting === enabled.length ? 'Waiting for the first check' : 'All systems operational'}</p>
    <p class="muted" style="margin:2px 0 0;font-size:14px">${enabled.length} checks every minute · ${openInc} open incident${openInc === 1 ? '' : 's'} · alerts on ${d.push_devices} device${d.push_devices === 1 ? '' : 's'}</p></div>
    ${d.push_devices ? `<button class="btn" data-act="push-test">${ICON.bell}Send a test alert</button>` : `<button class="btn primary" data-act="push-on">${ICON.bell}Turn on alerts on this device</button>`}
  </section>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(min(440px,100%),1fr))">
    ${enabled.map((c) => { const p = proj[c.project_id] || { color: '#52525B', initials: '?', name: c.project_id }; const state = !c.last_at ? 'off' : c.last_ok ? 'up' : 'down';
      return `<article class="card stripe rise" style="--c:${esc(p.color)};display:flex;flex-direction:column;gap:14px;padding-top:24px">
        <div class="row">${tile(p)}<div style="flex:1;min-width:0"><h2 style="font-size:16px">${esc(p.name)} <span class="muted" style="font-weight:400">· ${esc(c.name)}</span></h2><a class="mono muted" style="font-size:12px" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(host(c.url))} ↗</a></div><span class="pill ${state}">${state === 'up' ? 'Up' : state === 'down' ? 'Down' : 'Waiting'}</span></div>
        <div class="spk-wide ${state === 'down' ? 'down' : ''}"><div class="row muted" style="justify-content:space-between;font-size:12px;margin-bottom:4px"><span>Response time · 24 h</span><span>${(() => { const v = (c.spark || []).filter((p) => p && p.ms != null).map((p) => p.ms); return v.length ? `avg ${Math.round(v.reduce((a, b) => a + b, 0) / v.length)} ms` : 'no data yet'; })()}</span></div>${spark(c.spark || [], { w: 400, h: 44 })}</div>
        <dl class="metrics"><div><dt>Uptime · 90d</dt><dd>${c.uptime == null ? '—' : (c.uptime * 100).toFixed(c.uptime === 1 ? 0 : 2) + '%'}</dd></div><div><dt>Response</dt><dd>${c.last_ms != null ? c.last_ms + ' ms' : '—'}</dd></div><div><dt>Last result</dt><dd>${c.last_at ? (c.last_ok ? 'HTTP ' + (c.last_status || 'OK') : esc(c.last_error || 'Failed')) : '—'}</dd></div><div><dt>Checked</dt><dd>${esc(rel(c.last_at))}</dd></div></dl>
        <div><div class="strip" role="img" aria-label="${esc(p.name)}: daily uptime for the last 90 days">${strip(c)}</div><div class="row muted" style="justify-content:space-between;margin-top:6px;font-size:12px"><span>90 days ago</span><span>Today</span></div></div>
      </article>`; }).join('')}
  </div>
  <div class="split" style="margin-top:16px">
    <section class="card wide" aria-labelledby="inc-h"><h2 id="inc-h" class="ih" style="margin-bottom:10px">${L('circle-alert', 16)}Incidents</h2>
      ${d.incidents.map((i) => `<div style="border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-top:10px"><div class="row" style="flex-wrap:wrap;gap:8px 10px"><span class="pill ${i.resolved_at ? 'up' : 'down'}">${i.resolved_at ? 'Resolved' : 'Open'}</span><span class="row" style="gap:6px;font-size:13px;font-weight:500"><span class="dot" style="width:8px;height:8px;border-radius:2px;background:${esc(i.color || '#52525B')}"></span>${esc(i.project_name || 'Hub')}</span><span class="muted" style="margin-left:auto;font-size:12px">${esc(rel(i.started_at))}${i.resolved_at ? ` · lasted ${Math.max(1, Math.round((i.resolved_at - i.started_at) / 60000))} min` : ''}</span></div><p style="margin:8px 0 0;font-weight:600">${esc(i.title)}</p>${i.detail ? `<p class="muted" style="margin:2px 0 0;font-size:14px">${esc(i.detail)}</p>` : ''}${i.resolved_at ? '' : `<button class="btn small" style="margin-top:10px" data-act="resolve" data-id="${i.id}">Mark resolved</button>`}</div>`).join('') || '<p class="muted" style="margin:0;font-size:14px">No incidents yet.</p>'}
    </section>
    <section class="card narrow" aria-labelledby="ch-h" style="display:block"><div class="card-head">${H('ch-h', 'shield-check', 'Checks')}<button class="btn small" data-act="add-check">+ Add</button></div>
      ${S.showForm === 'check' ? `<form data-form="check" style="display:flex;flex-direction:column;gap:10px;margin:10px 0"><label class="field"><span>Project</span><select class="input" name="project_id">${d.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><label class="field"><span>Name</span><input class="input" name="name" required maxlength="40" placeholder="Health"></label><label class="field"><span>Address to call</span><input class="input" name="url" type="url" required placeholder="https://…/health"></label><label class="field"><span>Text that must appear (optional)</span><input class="input" name="expect_text" maxlength="120"></label><div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn small" data-act="cancel-form">Cancel</button><button class="btn small primary">Save check</button></div></form>` : ''}
      ${d.checks.map((c) => `<div class="row" style="padding:10px 0;border-top:1px solid var(--border);gap:10px"><span class="dot" style="width:8px;height:8px;border-radius:2px;background:${esc((proj[c.project_id] || {}).color || '#52525B')}"></span><span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font-size:14px">${esc((proj[c.project_id] || {}).name || c.project_id)} · ${esc(c.name)}</span><span class="mono muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.url)}</span></span><input type="checkbox" class="switch" role="switch" aria-label="Check ${esc(c.name)} on" data-act="check-on" data-id="${c.id}" ${c.enabled ? 'checked' : ''}></div>`).join('')}
    </section>
  </div>
</div>`;
  return { crumb: 'Monitoring', html };
}

// ---------- finances ----------
const SRC = { stripe: ['Stripe', 'receipt'], recurring: ['Bill', 'refresh-cw'], domain: ['Domain', 'globe'], manual: ['Manual', 'pencil'] };
// Common bills to add in one tap; you fill in your own amount since it depends on your plan.
const BILL_PRESETS = [
  { name: 'Google Workspace', cadence: 'monthly', icon: 'at-sign' },
  { name: 'Railway', cadence: 'monthly', icon: 'train-front' },
  { name: 'Cloudflare Workers Paid', cadence: 'monthly', icon: 'cloud' },
  { name: 'GitHub', cadence: 'monthly', icon: 'git-branch' },
];
const shortMonth = (m) => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short' });
function delta(now, before, { goodUp = true } = {}) {
  if (!before && !now) return '<span class="delta flat">No change</span>';
  if (!before) return '<span class="delta flat">New this period</span>';
  const pct = Math.round(((now - before) / before) * 100);
  if (!pct) return '<span class="delta flat">Same as last time</span>';
  const up = pct > 0;
  return `<span class="delta ${up === goodUp ? 'good' : 'bad'}">${L(up ? 'trending-up' : 'trending-down', 13)}${up ? '+' : ''}${pct}% vs last ${S.period === 'year' ? 'year' : 'month'}</span>`;
}

function viewFinances(d) {
  const t = d.totals;
  const per = d.period === 'year' ? 'this year' : 'this month';
  // 12 months of income and costs.
  const months = [];
  for (let i = 11; i >= 0; i--) { const x = new Date(d.today.slice(0, 7) + '-15T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() - i); months.push(x.toISOString().slice(0, 7)); }
  const inc = Object.fromEntries(months.map((m) => [m, 0])); const out = Object.fromEntries(months.map((m) => [m, 0]));
  for (const h of d.history) if (h.month in inc) { if (h.kind === 'income') inc[h.month] += h.cents; else out[h.month] += h.cents; }
  const top = Math.max(1, ...months.map((m) => Math.max(inc[m], out[m])));
  const step = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000].find((x) => x * 4 >= top) || Math.ceil(top / 4);
  const scale = step * 4;
  const anyMoney = months.some((m) => inc[m] || out[m]);

  // Every site, busiest first.
  const prows = d.by_site.slice().sort((a, b) => (b.income + b.costs + b.bills_monthly) - (a.income + a.costs + a.bills_monthly));
  const pmax = Math.max(1, ...prows.map((r) => Math.max(r.income, r.costs)));
  const siteName = d.site === '_' ? 'Shared costs' : d.site ? (d.projects.find((p) => p.id === d.site) || {}).name : '';
  const scope = siteName ? siteName : 'all sites';

  // Break-even.
  const be = d.break_even;
  const prog = be ? Math.min(100, Math.round((d.tournaments_month / be) * 100)) : 0;
  const left = Math.max(0, be - d.tournaments_month);
  const projOpts = (sel, none = 'Shared / none') => `<option value="">${none}</option>${d.projects.map((p) => `<option value="${esc(p.id)}"${sel === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  const F = S.fin;

  const ledgerRow = (r) => {
    const [srcLabel, srcIcon] = SRC[r.source] || [r.source, 'receipt'];
    const sign = r.kind === 'income' ? '+' : '−';
    return `<button class="lrow2" data-act="edit-entry" data-id="${r.id}" aria-label="Edit ${esc(r.description)}">
      <span class="src" title="${esc(srcLabel)}">${L(srcIcon, 15)}</span>
      <span class="grow"><b>${esc(r.description)}</b><span>${esc(dateLabel(r.occurred_on))} · <span class="dot" style="width:7px;height:7px;border-radius:2px;background:${esc(r.color || '#71717A')}"></span> ${esc(r.project_name || 'Shared')} · ${esc(srcLabel)}</span></span>
      <b class="amt ${r.kind === 'income' ? 'in' : ''}">${sign}${money(r.amount_cents).replace('−', '')}</b></button>`;
  };

  const html = `<div class="page">
  <div class="page-head rise"><div>${d.site ? `<a href="#/finances" class="back">${L('arrow-right', 14, 'flip')}All finances</a>` : ''}<h1 class="${d.site ? '' : 'd-only'}">${d.site ? esc(siteName) : 'Finances'}</h1><p>${d.site ? (d.site === '_' ? 'Costs that aren’t tied to one site, like your workspace and tools.' : `Money in and out for ${esc(siteName)}.`) : 'Every site at a glance. Stripe charges and monthly bills are added automatically.'}</p></div>
    <div class="row" style="gap:10px;flex-wrap:wrap"><div class="seg" role="group" aria-label="Period"><button class="${d.period === 'month' ? 'on' : ''}" aria-pressed="${d.period === 'month'}" data-act="period" data-v="month">Month</button><button class="${d.period === 'year' ? 'on' : ''}" aria-pressed="${d.period === 'year'}" data-act="period" data-v="year">Year</button></div>
    <a class="btn exp" href="/api/ledger.csv" download aria-label="Export CSV">${L('download', 15)}<span>Export CSV</span></a><button class="btn primary grow-m" data-act="add-entry">${ICON.plus}Add entry</button></div></div>
  ${finTabs(d.site, d.projects)}
  ${S.showForm === 'entry' ? entryForm(null, d, projOpts) : ''}
  <div class="kpis rise">
    <div class="kpi"><p class="l">${L('trending-up', 14)}Income ${per}</p><p class="v">${money(t.income)}</p>${delta(t.income, d.prev.income)}</div>
    <div class="kpi"><p class="l">${L('trending-down', 14)}Costs ${per}</p><p class="v">${money(t.costs)}</p>${delta(t.costs, d.prev.costs, { goodUp: false })}</div>
    <div class="kpi"><p class="l">${L('scale', 14)}Net ${per}</p><p class="v ${t.net < 0 ? 'neg' : ''}">${money(t.net)}</p><span class="delta flat">${t.net >= 0 ? 'Income covers costs' : 'Costs are higher than income'}</span></div>
    <div class="kpi"><p class="l">${L('calendar-clock', 14)}Operating costs</p><p class="v">${money(d.fixed_monthly)}<small>/mo</small></p><span class="delta flat">A month · bills + domains · ${esc(scope)}</span></div>
  </div>

  ${d.site && d.site !== 'tc' ? `<section class="card be rise" aria-labelledby="be-h" style="margin-top:16px">
    <div class="card-head">${H('be-h', 'target', 'Cost to run')}<span class="muted">${d.totals.income ? '' : `${esc(siteName)} doesn’t take payments — Tournament Central’s income covers it`}</span></div>
    ${d.fixed_monthly ? `<div class="be-row"><div><p class="be-big"><b>${money(d.fixed_monthly)}</b> a month</p>
      <p class="muted" style="margin:2px 0 0;font-size:14px">About ${Math.ceil(d.fixed_monthly / d.net_per_tournament)} Tournament Central listing${Math.ceil(d.fixed_monthly / d.net_per_tournament) === 1 ? '' : 's'} a month pay for it · ${Math.round((d.fixed_monthly / Math.max(1, d.fixed_all)) * 100)}% of everything you spend to run your sites.</p></div></div>
      <div class="meter share" role="img" aria-label="Share of all running costs"><span style="width:${Math.min(100, (d.fixed_monthly / Math.max(1, d.fixed_all)) * 100).toFixed(1)}%"></span></div>`
    : `<div class="empty">${L('calendar-clock', 28)}<span>No bills or domains added for ${esc(scope)} yet. Add them below to see what it costs to run.</span></div>`}
  </section>` : `<section class="card be rise" aria-labelledby="be-h" style="margin-top:16px">
    <div class="card-head">${H('be-h', 'target', d.site ? 'Break-even · Tournament Central on its own' : 'Break-even · all sites')}<span class="muted">${money(d.net_per_tournament)} kept per $5 listing after Stripe</span></div>
    ${be ? `<div class="be-row"><div><p class="be-big"><b>${d.tournaments_month}</b> of <b>${be}</b> tournaments this month</p>
      <p class="muted" style="margin:2px 0 0;font-size:14px">${left ? `${left} more to cover ${money(d.fixed_monthly)} a month in operating costs${d.site ? ' for Tournament Central' : ' across every site'}.` : `Covered — every tournament from here is profit.`}</p></div>
      <span class="pill ${left ? 'progress' : 'live'}">${left ? `${prog}%` : 'Covered'}</span></div>
      <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${be}" aria-valuenow="${d.tournaments_month}" aria-label="Tournaments toward break-even"><span style="width:${prog}%"></span></div>`
    : `<div class="empty">${L('calendar-clock', 28)}<span>Add your monthly bills (Railway, Cloudflare, domains…) and this shows how many $5 tournaments a month cover ${d.site ? 'Tournament Central' : 'every site'}.</span></div>`}
  </section>`}

  ${d.site ? '' : `<section class="rise" aria-labelledby="sites-h" style="margin-top:28px"><div class="row" style="justify-content:space-between;margin-bottom:12px"><h2 id="sites-h" class="ih" style="margin:0;font-size:18px;font-weight:600">${L('globe', 18)}Sites · ${per}</h2><span class="muted" style="font-size:13px">Open a site for its own page</span></div>
    <div class="site-grid">${prows.map((r) => { const key = r.project_id || '_'; const net = r.income - r.costs; return `<a class="card stripe site-card" style="--c:${esc(r.color)}" href="#/finances/${esc(key)}">
      <span class="row" style="gap:10px">${r.project_id ? tile(d.projects.find((p) => p.id === r.project_id) || { color: r.color, initials: '?' }, 'sm') : `<span class="tile sm ic">${L('wallet', 13)}</span>`}<b style="flex:1;min-width:0;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name)}</b>${L('chevron-right', 16, 'muted')}</span>
      <span class="site-net ${net < 0 ? 'neg' : net > 0 ? 'pos' : ''}">${money(net)}<small>net</small></span>
      ${r.income || r.costs ? `<span class="minibars"><span class="in" style="width:${((r.income / pmax) * 100).toFixed(1)}%"></span><span class="out" style="width:${((r.costs / pmax) * 100).toFixed(1)}%"></span></span>` : ''}
      <span class="muted" style="font-size:12px">${money(r.income)} in · ${money(r.costs)} out${r.bills_monthly ? ` · operates at ${money(r.bills_monthly)}/mo` : ''}</span></a>`; }).join('')}</div></section>`}
  <div class="split fin-cols" style="margin-top:16px">
    <div class="wide col">
    <section class="card rise" aria-labelledby="inc-h"><div class="card-head">${H('inc-h', 'chart-column', `Income and costs · ${esc(scope)}`)}<span class="legend"><span><i style="background:var(--s-in)"></i>Income</span><span><i style="background:var(--s-out)"></i>Costs</span></span></div>
      <div class="chart" role="img" aria-label="${esc('Last 12 months. ' + months.map((m) => `${shortMonth(m)}: income ${money(inc[m])}, costs ${money(out[m])}`).join('; '))}">
        <div class="axis">${[4, 3, 2, 1, 0].map((i) => `<span>${money(step * i, true)}</span>`).join('')}</div>
        <div class="plot">
          ${months.map((m, i) => `<div class="mcol${i === 11 ? ' now' : ''}" tabindex="0">
            <div class="pair"><span class="b in" style="height:${((inc[m] / scale) * 100).toFixed(1)}%"></span><span class="b out" style="height:${((out[m] / scale) * 100).toFixed(1)}%"></span></div>
            <span class="mlab">${shortMonth(m)}</span>
            <div class="tip"><b>${new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</b><span><i style="background:var(--s-in)"></i>Income<em>${money(inc[m])}</em></span><span><i style="background:var(--s-out)"></i>Costs<em>${money(out[m])}</em></span><span class="net">Net<em>${money(inc[m] - out[m])}</em></span></div>
          </div>`).join('')}
        </div>
      </div>
      ${anyMoney ? '' : '<p class="muted" style="margin:10px 0 0;font-size:13px">No money recorded yet — bars appear as charges and bills come in.</p>'}
    </section>
    <section class="card rise" style="padding:0;overflow:hidden" aria-labelledby="led-h">
      <div class="led-head"><div class="card-head" style="margin:0">${H('led-h', 'receipt', 'Ledger')}<span class="muted">Tap an entry to edit</span></div>
        <div class="led-filters">
          <div class="seg" role="group" aria-label="Show">${[['all', 'All'], ['in', 'Income'], ['out', 'Costs']].map(([k, l]) => `<button class="${F.kind === k ? 'on' : ''}" aria-pressed="${F.kind === k}" data-act="fin-kind" data-v="${k}">${l}</button>`).join('')}</div>
          
          <label class="search-in">${L('search', 15)}<span class="sr">Search the ledger</span><input class="input sm" id="fin-q" type="search" placeholder="Search…" value="${esc(F.q)}" autocomplete="off"></label>
        </div></div>
      <div class="led-list">${d.rows.map(ledgerRow).join('') || `<p class="muted" style="padding:20px;margin:0;font-size:14px;text-align:center">${F.q || d.site || F.kind !== 'all' ? 'No entries match.' : 'No entries yet.'}</p>`}</div>
      ${d.more ? '<div style="padding:12px 20px;border-top:1px solid var(--border)"><button class="btn small" data-act="fin-more">Show more</button></div>' : ''}
    </section>
    </div>
    <aside class="narrow">
      <section class="card rise" aria-labelledby="up-h"><div class="card-head">${H('up-h', 'clock', 'Coming up')}<span class="muted">Next 60 days</span></div>
        ${d.upcoming.map((u) => `<div class="row" style="padding:10px 0;border-top:1px solid var(--border);gap:10px"><span class="when"><b>${new Date(u.on + 'T12:00:00').getDate()}</b>${new Date(u.on + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })}</span><span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font-size:14px;font-weight:500">${esc(u.name)}</span><span class="muted" style="font-size:12px">${u.type === 'domain' ? 'Domain renewal' : 'Bill'}${u.project_name ? ' · ' + esc(u.project_name) : ''}</span></span><b class="num" style="font-size:14px">${money(u.cents)}</b></div>`).join('') || '<p class="muted" style="margin:6px 0 0;font-size:14px">Nothing due soon.</p>'}
      </section>
      
      <section class="card" aria-labelledby="rec-h"><div class="card-head">${H('rec-h', 'refresh-cw', 'Operating costs')}<button class="btn small" data-act="add-recurring">+ Add bill</button></div>
        <p class="muted" style="margin:0 0 8px;font-size:13px">${d.fixed_monthly ? `<b style="color:var(--text);font-size:15px">${money(d.fixed_monthly)}</b> a month for ${esc(scope)}. Bills and domain renewals are logged to the ledger on their dates.` : 'What it costs to keep things running. Add a bill once and it’s logged automatically every time it’s due; domains count too.'}</p>
        ${S.showForm === 'recurring' ? `<form data-form="recurring" style="display:flex;flex-direction:column;gap:10px;margin:6px 0 10px">
          <div class="choices" role="group" aria-label="Common bills">${BILL_PRESETS.map((p, i) => `<button type="button" class="choice" data-act="bill-preset" data-i="${i}">${L(p.icon, 13)}${esc(p.name)}</button>`).join('')}</div>
          <label class="field"><span>What is it?</span><input class="input" name="name" required maxlength="80" placeholder="Railway — Hobby plan" value="${esc(S.billDraft?.name || '')}"></label><div class="form-row"><label class="field"><span>Amount (USD)</span><input class="input" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required placeholder="5.00"></label><label class="field"><span>Every</span><select class="input" name="cadence"><option value="monthly">Month</option><option value="yearly"${S.billDraft?.cadence === 'yearly' ? ' selected' : ''}>Year</option></select></label></div><div class="form-row"><label class="field"><span>Next charge</span><input class="input" type="date" name="next_on" required value="${esc(d.today)}"></label><label class="field"><span>Site</span><select class="input" name="project_id">${projOpts(d.site && d.site !== '_' ? d.site : '', 'Shared / all sites')}</select></label></div><div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn small" data-act="cancel-form">Cancel</button><button class="btn small primary">Save bill</button></div></form>` : ''}
        ${d.recurring.length ? `<p class="sub-h">Bills</p>` : ''}
        ${d.recurring.map((r) => `<div class="row oc-row" style="${r.active ? '' : 'opacity:.55'}"><span class="dot" style="width:8px;height:8px;border-radius:2px;background:${esc(r.color || '#71717A')}"></span><span class="oc-edit" role="button" tabindex="0" data-act="edit-bill" data-id="${r.id}" title="Edit bill" style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font-size:14px;font-weight:500">${esc(r.name)}</span><span class="muted" style="font-size:12px">${money(r.amount_cents)} / ${r.cadence === 'yearly' ? 'year' : 'month'} · ${r.active ? 'next ' + esc(dateLabel(r.next_on)) : 'paused'}${d.site ? '' : ` · ${esc(r.project_name || 'Shared')}`}</span></span><input type="checkbox" class="switch" role="switch" aria-label="${esc(r.name)} active" data-act="rec-on" data-id="${r.id}" ${r.active ? 'checked' : ''}><button class="icon-btn" data-act="edit-bill" data-id="${r.id}" aria-label="Edit ${esc(r.name)}">${ICON.edit}</button><button class="icon-btn" data-act="del-recurring" data-id="${r.id}" aria-label="Delete ${esc(r.name)}">${ICON.trash}</button></div>`).join('')}
        ${d.renewals.length ? `<p class="sub-h">Domains <a href="#/finances/domains" style="font-weight:500">Manage →</a></p>` : ''}
        ${d.renewals.map((r) => `<div class="row oc-row"><span class="dot" style="width:8px;height:8px;border-radius:2px;background:${esc(r.color || '#71717A')}"></span><span style="flex:1;min-width:0;display:flex;flex-direction:column"><span class="mono" style="font-size:13px;font-weight:500">${esc(r.domain)}</span><span class="muted" style="font-size:12px">${money(r.price_cents)} / year · ≈ ${money(Math.round(r.price_cents / 12))}/mo · renews ${esc(dateLabel(r.renews_on))}</span></span></div>`).join('')}
      </section>

    </aside>
  </div>
</div>`;
  return { crumb: 'Finances', html };
}

function finTabs(cur, projects) {
  const t = (key, href, inner) => `<a class="filter${cur === key ? ' on' : ''}" ${cur === key ? 'aria-current="page"' : ''} href="${href}">${inner}</a>`;
  return `<nav class="hscroll site-pick rise" aria-label="Finances pages">
    ${t('', '#/finances', `${L('layout-dashboard', 14)}Overview`)}
    ${t('domains', '#/finances/domains', `${L('globe', 14)}Domains`)}
    <span class="sep" aria-hidden="true"></span>
    ${projects.map((p) => t(p.id, `#/finances/${esc(p.id)}`, `<span class="dot" style="width:8px;height:8px;border-radius:2px;background:${esc(p.color)}"></span>${esc(p.name)}`)).join('')}
    ${t('_', '#/finances/_', 'Shared costs')}
  </nav>`;
}

// ---------- domains ----------
function viewDomains(d) {
  const days = (on) => Math.round((new Date(on + 'T12:00:00') - new Date(d.today + 'T12:00:00')) / 86400000);
  const yearly = d.domains.reduce((a, r) => a + r.price_cents, 0);
  const soon = d.domains.filter((r) => days(r.renews_on) >= 0 && days(r.renews_on) <= 30);
  const late = d.domains.filter((r) => days(r.renews_on) < 0);
  const next = d.domains.find((r) => days(r.renews_on) >= 0);
  const left = (r) => { const n = days(r.renews_on); return n < 0 ? `<span class="pill down">${-n} day${n === -1 ? '' : 's'} overdue</span>` : n <= 30 ? `<span class="pill progress">${n === 0 ? 'Today' : `${n} day${n === 1 ? '' : 's'}`}</span>` : `<span class="pill off">${n} days</span>`; };
  const html = `<div class="page">
  <div class="page-head rise"><div><a href="#/finances" class="back">${L('arrow-right', 14, 'flip')}All finances</a><h1>Domains</h1><p>Every domain you own. Each renewal is logged as an operating cost for its site — automatically for auto-renew, or when you mark it renewed.</p></div>
    <button class="btn primary grow-m" data-act="add-domain">${ICON.plus}Add domain</button></div>
  ${finTabs('domains', d.projects)}
  <div class="kpis rise">
    <div class="kpi"><p class="l">${L('globe', 14)}Domains</p><p class="v">${d.domains.length}</p><span class="delta flat">${d.domains.filter((r) => r.auto).length} on auto-renew</span></div>
    <div class="kpi"><p class="l">${L('receipt', 14)}Per year</p><p class="v">${money(yearly)}</p><span class="delta flat">About ${money(Math.round(yearly / 12))} a month</span></div>
    <div class="kpi"><p class="l">${L('calendar-clock', 14)}Next renewal</p><p class="v mono" style="font-size:18px;padding-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${next ? esc(next.domain) : '—'}</p><span class="delta flat">${next ? `${esc(dateLabel(next.renews_on))} · ${money(next.price_cents)}` : 'Nothing scheduled'}</span></div>
    <div class="kpi"><p class="l">${L('circle-alert', 14)}Needs attention</p><p class="v ${late.length ? 'neg' : ''}">${late.length + soon.length}</p><span class="delta ${late.length ? 'bad' : 'flat'}">${late.length ? `${late.length} overdue` : soon.length ? 'Renewing within 30 days' : 'Nothing due in 30 days'}</span></div>
  </div>
  ${S.showForm === 'domain' ? domainForm(null, d) : ''}
  <section class="card rise" style="padding:0;overflow:hidden;margin-top:16px" aria-labelledby="dm-h">
    <div class="card-head" style="padding:18px 20px 10px;margin:0">${H('dm-h', 'globe', 'All domains')}<span class="muted">Soonest first · tap to edit</span></div>
    ${d.domains.map((r) => `<button class="drow" data-act="edit-domain" data-id="${r.id}" aria-label="Edit ${esc(r.domain)}">
      <span class="grow"><b class="mono">${esc(r.domain)}</b><span>${r.project_name ? `<span class="dot" style="width:7px;height:7px;border-radius:2px;background:${esc(r.color)}"></span> ${esc(r.project_name)}` : 'No site'} · ${r.auto ? 'Auto-renews' : 'Renew by hand'}</span></span>
      <span class="dwhen">${esc(dateLabel(r.renews_on))}</span>${!r.auto && days(r.renews_on) <= 30 ? `<span class="btn small" role="button" tabindex="0" data-act="mark-renewed" data-id="${r.id}">${L('check', 14)}Mark renewed</span>` : ''}${left(r)}<b class="num damt">${money(r.price_cents)}<small>/yr</small></b>${L('chevron-right', 16, 'muted chev')}</button>`).join('')
      || `<div class="empty big" style="margin:16px 20px 20px">${L('globe', 32)}<b style="color:var(--text)">No domains yet</b><span>Add each one once with its renewal date. They show up in Coming up on the Finances page and count toward running costs.</span><button class="btn primary" data-act="add-domain">${ICON.plus}Add domain</button></div>`}
  </section>
</div>`;
  return { crumb: 'Domains', html };
}

function domainForm(r, d) {
  const v = r || { domain: '', renews_on: '', price_cents: '', project_id: '', auto: 1 };
  return `<form class="card rise" data-form="domain" data-id="${r ? r.id : ''}" style="margin-top:16px;display:flex;flex-direction:column;gap:12px"><h2>${r ? 'Edit domain' : 'Add a domain'}</h2>
    <div class="form-row"><label class="field" style="flex:2 1 240px"><span>Domain</span><input class="input mono" name="domain" required maxlength="120" placeholder="tournamentcentral.app" value="${esc(v.domain)}"></label><label class="field"><span>Renews on</span><input class="input" type="date" name="renews_on" required value="${esc(v.renews_on)}"></label><label class="field"><span>Price per year (USD)</span><input class="input" type="number" min="0" step="0.01" inputmode="decimal" name="price" value="${v.price_cents !== '' ? (v.price_cents / 100).toFixed(2) : ''}" placeholder="14.00"></label></div>
    <div class="form-row"><label class="field"><span>Site</span><select class="input" name="project_id"><option value="">No site</option>${d.projects.map((p) => `<option value="${esc(p.id)}"${v.project_id === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><label class="field"><span>Renewal</span><select class="input" name="auto"><option value="1"${v.auto ? ' selected' : ''}>Auto-renews</option><option value="0"${v.auto ? '' : ' selected'}>Renew by hand</option></select></label></div>
    <div class="row" style="justify-content:space-between;gap:10px">${r ? `<button type="button" class="btn danger" data-act="del-domain" data-id="${r.id}">${ICON.trash}Delete</button>` : '<span></span>'}<div class="row" style="gap:10px"><button type="button" class="btn" data-act="cancel-form">Cancel</button><button class="btn primary">${r ? 'Save' : 'Add domain'}</button></div></div></form>`;
}

function billDialog(r) {
  const d = S.data;
  S.palette = { mode: 'bill' };
  $('#overlay').innerHTML = `<div class="scrim" data-act="scrim"><div class="dialog" role="dialog" aria-modal="true" aria-label="Edit bill"><form class="pad" data-form="bill" data-id="${r.id}">
    <h2>Edit bill</h2>
    <div class="form-row"><label class="field" style="flex:2 1 240px"><span>What is it?</span><input class="input" name="name" required maxlength="80" value="${esc(r.name)}"></label><label class="field"><span>Amount (USD)</span><input class="input" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${(r.amount_cents / 100).toFixed(2)}"></label></div>
    <div class="form-row"><label class="field"><span>Every</span><select class="input" name="cadence"><option value="monthly"${r.cadence === 'monthly' ? ' selected' : ''}>Month</option><option value="yearly"${r.cadence === 'yearly' ? ' selected' : ''}>Year</option></select></label><label class="field"><span>Next charge</span><input class="input" type="date" name="next_on" required value="${esc(r.next_on)}"></label><label class="field"><span>Site</span><select class="input" name="project_id"><option value="">Shared / all sites</option>${d.projects.map((p) => `<option value="${esc(p.id)}"${r.project_id === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>
    <p class="muted" style="margin:0;font-size:13px">Changes apply from the next charge on. Charges already in the ledger stay as they were — edit those in the ledger if needed.</p>
    <div class="row" style="justify-content:space-between;gap:10px"><button type="button" class="btn danger" data-act="del-recurring" data-id="${r.id}">${ICON.trash}Delete</button><div class="row" style="gap:10px"><button type="button" class="btn" data-act="close-palette">Cancel</button><button class="btn primary">Save</button></div></div>
  </form></div></div>`;
  $('#overlay input[name="name"]').focus();
}

function entryForm(r, d, projOpts) {
  const v = r || { kind: 'cost', description: '', amount_cents: '', occurred_on: d.today, project_id: d.site && d.site !== '_' ? d.site : '' };
  const locked = r && r.source === 'stripe';
  return `<form class="card rise" data-form="entry" data-id="${r ? r.id : ''}" style="margin-bottom:16px;display:flex;flex-direction:column;gap:12px"><h2>${r ? 'Edit entry' : 'Add an entry'}</h2>
    ${locked ? '<p class="muted" style="margin:0;font-size:13px">This came from Stripe, so only its site can be changed.</p>' : ''}
    <div class="form-row"><label class="field" style="flex:2 1 240px"><span>What is it?</span><input class="input" name="description" required maxlength="200" placeholder="Railway — November usage" value="${esc(v.description)}" ${locked ? 'disabled' : ''}></label><label class="field"><span>Amount (USD)</span><input class="input" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required placeholder="0.00" value="${v.amount_cents ? (v.amount_cents / 100).toFixed(2) : ''}" ${locked ? 'disabled' : ''}></label><label class="field"><span>Date</span><input class="input" name="occurred_on" type="date" value="${esc(v.occurred_on)}" ${locked ? 'disabled' : ''}></label></div>
    <div class="form-row"><label class="field"><span>Type</span><select class="input" name="kind" ${locked ? 'disabled' : ''}>${[['cost', 'Cost'], ['income', 'Income'], ['fee', 'Fee'], ['refund', 'Refund']].map(([k, l]) => `<option value="${k}"${v.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label><label class="field"><span>Site</span><select class="input" name="project_id">${projOpts(v.project_id || '')}</select></label></div>
    <div class="row" style="justify-content:space-between;gap:10px">${r && !locked ? `<button type="button" class="btn danger" data-act="del-entry" data-id="${r.id}">${ICON.trash}Delete</button>` : '<span></span>'}<div class="row" style="gap:10px"><button type="button" class="btn" data-act="cancel-form">Cancel</button><button class="btn primary">${r ? 'Save' : 'Save entry'}</button></div></div></form>`;
}

function editEntryDialog(r) {
  const d = S.data;
  const projOpts = (sel) => `<option value="">Shared / none</option>${d.projects.map((p) => `<option value="${esc(p.id)}"${sel === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  S.palette = { mode: 'entry' };
  $('#overlay').innerHTML = `<div class="scrim" data-act="scrim"><div class="dialog" role="dialog" aria-modal="true" aria-label="Edit entry">${entryForm(r, d, projOpts).replace('class="card rise"', 'class="pad"').replace('margin-bottom:16px;', '')}</div></div>`;
}

// ---------- command palette + quick note ----------
function paletteItems() {
  const q = (S.palette.q || '').trim().toLowerCase();
  const m = (s) => !q || s.toLowerCase().includes(q);
  const actions = [
    { label: 'New note', icon: 'notebook-pen', hint: 'N', run: () => { S.palette.mode = 'note'; drawPalette(); } },
    { label: isDark() ? 'Switch to light mode' : 'Switch to dark mode', icon: isDark() ? 'sun' : 'moon', hint: 'T', run: () => { setTheme(!isDark()); closePalette(); render({ quiet: true }); } },
    { label: 'Run uptime checks now', icon: 'refresh-cw', hint: '', run: () => { closePalette(); location.hash = '#/monitoring'; runChecksNow(); } },
    { label: 'Add an expense', icon: 'receipt', hint: '', run: () => { closePalette(); S.showForm = 'entry'; location.hash = '#/finances'; render(); } },
    { label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', run: () => { closePalette(); showShortcuts(); } },
  ].filter((a) => m(a.label));
  const pages = [['Dashboard', '#/', 'layout-dashboard'], ['Projects', '#/projects', 'folder'], ['Monitoring', '#/monitoring', 'activity'], ['Finances', '#/finances', 'wallet'], ['Domains', '#/finances/domains', 'globe']]
    .filter(([l]) => m(l)).map(([label, href, icon]) => ({ label, href, icon }));
  const projects = S.projects.filter((p) => m(p.name)).map((p) => ({ label: p.name, href: '#/p/' + p.id, p }));
  const found = S.palette.found && S.palette.found.q === q ? S.palette.found : { notes: [], links: [] };
  const notes = found.notes.map((n) => ({ label: n.text, sub: `${n.project_name} · ${KIND_LABEL[n.kind] || 'Note'}`, href: '#/p/' + n.project_id, p: { color: n.color, ink: n.ink, initials: n.initials } }));
  const links = found.links.map((l) => ({ label: `${l.label} — ${host(l.url)}`, sub: l.project_name, url: l.url, p: { color: l.color, ink: l.ink, initials: l.initials } }));
  return [...actions.map((a) => ({ ...a, group: 'Actions' })), ...projects.map((x) => ({ ...x, group: 'Projects' })), ...notes.map((x) => ({ ...x, group: 'Notes' })), ...links.map((x) => ({ ...x, group: 'Links' })), ...pages.map((x) => ({ ...x, group: 'Pages' }))];
}

function drawPalette() {
  const P = S.palette;
  const el = $('#overlay');
  if (!P) { el.innerHTML = ''; return; }
  if (P.mode === 'note') {
    const proj = P.project || (route().view === 'project' ? route().id : (S.projects[0] && S.projects[0].id));
    P.project = proj;
    el.innerHTML = `<div class="scrim" data-act="scrim"><form class="dialog" role="dialog" aria-modal="true" aria-label="New note" data-form="quick-note"><div class="pad">
      <div class="row" style="justify-content:space-between"><h2>New note</h2><span class="kbd">esc</span></div>
      <label class="sr" for="qn">Note</label><textarea class="input" id="qn" name="text" rows="4" required maxlength="2000" placeholder="What's on your mind? A to-do, an idea, where you left off…"></textarea>
      <div class="choices sheet-choices" role="group" aria-label="Project">${S.projects.map((p) => `<button type="button" class="choice" style="--c:${esc(p.color)}" aria-pressed="${p.id === proj}" data-act="qn-project" data-v="${esc(p.id)}"><span class="dot" style="width:8px;height:8px;border-radius:2px;background:${esc(p.color)}"></span>${esc(p.name)}</button>`).join('')}</div>
      <div class="row" style="flex-wrap:wrap;justify-content:space-between;gap:10px"><div class="row kinds" role="group" aria-label="Note type" style="gap:6px;flex-wrap:wrap">${['note', 'todo', 'idea', 'rule'].map((k) => `<button type="button" class="kind" aria-pressed="${(P.kind || 'note') === k}" data-act="qn-kind" data-v="${k}">${L(KIND_ICON[k], 14)}${KIND_LABEL[k]}</button>`).join('')}</div>
      <div class="row sheet-actions" style="gap:8px"><button type="button" class="btn" data-act="close-palette">Cancel</button><button class="btn primary">Save note</button></div></div>
    </div></form></div>`;
    const ta = $('#qn'); ta.value = P.draft || ''; ta.focus();
    ta.addEventListener('input', () => { P.draft = ta.value; });
    return;
  }
  const items = paletteItems();
  P.sel = Math.min(P.sel || 0, Math.max(0, items.length - 1));
  let group = '';
  const list = items.map((it, i) => {
    const head = it.group !== group ? `<p class="grp">${it.group}</p>` : '';
    group = it.group;
    const icon = it.p ? tile(it.p, 'sm') : `<span class="tile sm ic" aria-hidden="true">${L(it.icon || 'arrow-right', 14)}</span>`;
    const inner = `${icon}<span class="grow">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${it.hint ? `<span class="kbd">${esc(it.hint)}</span>` : it.url ? '<span class="muted">↗</span>' : ''}`;
    if (it.url) return head + `<a class="cmd${i === P.sel ? ' sel' : ''}" href="${esc(it.url)}" target="_blank" rel="noopener" data-act="close-palette" data-i="${i}">${inner}</a>`;
    return head + (it.href ? `<a class="cmd${i === P.sel ? ' sel' : ''}" href="${it.href}" data-act="close-palette" data-i="${i}">${inner}</a>` : `<button class="cmd${i === P.sel ? ' sel' : ''}" data-act="cmd" data-i="${i}">${inner}</button>`);
  }).join('');
  el.innerHTML = `<div class="scrim" data-act="scrim"><div class="dialog" role="dialog" aria-modal="true" aria-label="Command menu">
    <div class="cmd-in">${ICON.search}<label class="sr" for="cmdq">Search</label><input id="cmdq" placeholder="Search projects, notes, links, or type a command…" autocomplete="off" value="${esc(P.q || '')}"><span class="kbd">esc</span></div>
    <div class="cmd-list">${list || '<p class="muted" style="padding:24px;text-align:center;margin:0">No matches.</p>'}</div>
    <div class="cmd-foot"><span><span class="kbd">↑↓</span> move</span><span><span class="kbd">↵</span> open</span><span><span class="kbd">esc</span> close</span></div></div></div>`;
  const input = $('#cmdq');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.addEventListener('input', () => {
    P.q = input.value; P.sel = 0; drawPalette();
    // Search note text and links as you type (after a short pause).
    clearTimeout(P.timer);
    const q = P.q.trim().toLowerCase();
    if (q.length >= 2) P.timer = setTimeout(async () => {
      try { const r = await api('/search?q=' + encodeURIComponent(q)); if (S.palette === P && P.q.trim().toLowerCase() === q) { P.found = { q, ...r }; drawPalette(); } } catch { /* ignore */ }
    }, 160);
  });
  input.addEventListener('keydown', (e) => {
    const n = items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); P.sel = (P.sel + 1) % Math.max(1, n); drawPalette(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); P.sel = (P.sel - 1 + n) % Math.max(1, n); drawPalette(); }
    if (e.key === 'Enter' && items[P.sel]) { e.preventDefault(); const it = items[P.sel]; if (it.url) { closePalette(); window.open(it.url, '_blank', 'noopener'); } else if (it.href) { closePalette(); location.hash = it.href; } else it.run(); }
  });
}
function openPalette(mode = 'search') { S.palette = { mode, q: '', sel: 0 }; drawPalette(); }
function closePalette() { S.palette = null; drawPalette(); }

// ---------- shortcuts sheet ----------
const SHORTCUTS = [[`${MOD} K`, 'Search or run a command'], ['N', 'New note'], ['G then D', 'Go to Dashboard'], ['G then P', 'Go to Projects'], ['G then M', 'Go to Monitoring'], ['G then F', 'Go to Finances'], ['R', 'Refresh now'], ['T', 'Light / dark mode'], [`${MOD} ↵`, 'Save a note'], ['Esc', 'Close or cancel'], ['?', 'This list']];
function showShortcuts() {
  S.palette = { mode: 'help' };
  $('#overlay').innerHTML = `<div class="scrim" data-act="scrim"><div class="dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" style="max-width:440px"><div class="pad">
    <div class="row" style="justify-content:space-between"><h2>Keyboard shortcuts</h2><span class="kbd">esc</span></div>
    <dl class="keys">${SHORTCUTS.map(([k, l]) => `<div><dt>${l}</dt><dd>${k.split(' ').map((x) => (x === 'then' ? '<span class="muted">then</span>' : `<span class="kbd">${x}</span>`)).join(' ')}</dd></div>`).join('')}</dl>
  </div></div></div>`;
}

// ---------- project dialog ----------
function projectDialog(p) {
  const v = p || { name: '', type: '', status: 'progress', description: '', hosting: '', color: COLORS[7] };
  $('#overlay').innerHTML = `<div class="scrim" data-act="scrim"><form class="dialog" role="dialog" aria-modal="true" aria-label="${p ? 'Edit project' : 'Add project'}" data-form="project" data-id="${p ? esc(p.id) : ''}"><div class="pad">
    <h2>${p ? 'Edit project' : 'Add a project'}</h2>
    <div class="form-row"><label class="field" style="flex:2 1 220px"><span>Name</span><input class="input" name="name" required maxlength="60" value="${esc(v.name)}"></label><label class="field"><span>Initials</span><input class="input" name="initials" maxlength="3" value="${esc(v.initials || '')}" placeholder="TC"></label></div>
    <div class="form-row"><label class="field"><span>Type</span><input class="input" name="type" maxlength="60" value="${esc(v.type)}" placeholder="Web application"></label><label class="field"><span>Status</span><select class="input" name="status">${Object.entries(STATUS_LABEL).map(([k, l]) => `<option value="${k}"${v.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label><label class="field"><span>Hosting</span><input class="input" name="hosting" maxlength="40" value="${esc(v.hosting)}" placeholder="Railway"></label></div>
    <label class="field"><span>Description</span><textarea class="input" name="description" rows="2" maxlength="300">${esc(v.description)}</textarea></label>
    <div class="field"><span>Color</span><div class="choices" role="radiogroup" aria-label="Color">${COLORS.map((c) => `<label style="cursor:pointer"><input class="sr" type="radio" name="color" value="${c}"${c === v.color ? ' checked' : ''}><span class="tile sm" style="background:${c};outline:${c === v.color ? '2px solid var(--text)' : 'none'};outline-offset:2px" data-act="pick-color"></span></label>`).join('')}</div></div>
    <div class="row" style="justify-content:space-between;gap:10px">${p ? `<button type="button" class="btn danger" data-act="archive" data-id="${esc(p.id)}">Archive</button>` : '<span></span>'}<div class="row" style="gap:8px"><button type="button" class="btn" data-act="close-palette">Cancel</button><button class="btn primary">${p ? 'Save' : 'Add project'}</button></div></div>
  </div></form></div>`;
  $('#overlay input[name="name"]').focus();
}

// ---------- actions ----------
async function runChecksNow() {
  const btn = $('[data-act="run-checks"]');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin" style="display:inline-flex">${ICON.refresh}</span>Checking…`; }
  try {
    const { results } = await api('/monitoring/run', { method: 'POST' });
    const bad = results.filter((r) => !r.ok).length;
    toast(bad ? `${bad} of ${results.length} checks failed` : `All ${results.length} checks passed`, bad ? { error: true } : {});
    if (route().view === 'monitoring') render({ quiet: true });
  } catch (e) { fail(e); if (btn) btn.disabled = false; }
}

async function enablePush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser can’t receive notifications. On iPhone, add the hub to your home screen first.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications were not allowed.');
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('/push/key');
    const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
    await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    toast('Alerts are on for this device');
    render({ quiet: true });
  } catch (e) { fail(e); }
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  const id = t.dataset.id;
  const v = t.dataset.v;
  try {
    switch (act) {
      case 'side': S.collapsed = !S.collapsed; localStorage.setItem('side', S.collapsed ? 'collapsed' : 'open'); render({ quiet: true }); break;
      case 'theme': setTheme(!isDark()); render({ quiet: true }); break;
      case 'shortcuts': showShortcuts(); break;
      case 'palette': openPalette(); break;
      case 'new-note': openPalette('note'); break;
      case 'close-palette': if (t.tagName !== 'A') e.preventDefault(); closePalette(); break;
      case 'scrim': if (e.target === t) closePalette(); break;
      case 'cmd': { const it = paletteItems()[Number(t.dataset.i)]; if (it && it.run) it.run(); break; }
      case 'qn-project': S.palette.project = v; drawPalette(); break;
      case 'qn-kind': S.palette.kind = v; drawPalette(); break;
      case 'filter': S.filter = v; render({ quiet: true }); break;
      case 'tab': S.tab = v; render({ quiet: true }); break;
      case 'kind': S.kind = v; t.parentElement.querySelectorAll('.kind').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); break;
      case 'edit-note': if (e.target.closest('a')) break; S.editing = Number(id); render({ quiet: true }); setTimeout(() => { const ta = $(`#en-${id}`); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 0); break;
      case 'cancel-edit': S.editing = null; render({ quiet: true }); break;
      case 'pin': await api('/notes/' + id, { method: 'PATCH', body: { pinned: v === '1' } }); render({ quiet: true }); break;
      case 'del-note': {
        const { note } = await api('/notes/' + id, { method: 'DELETE' });
        toast('Note deleted', { undo: async () => { await api('/notes/restore', { method: 'POST', body: { note } }); render({ quiet: true }); } });
        render({ quiet: true });
        break;
      }
      case 'undo': { const u = S.undo; $('#toast').innerHTML = ''; S.undo = null; if (u) await u(); break; }
      case 'add-link': S.showForm = 'link'; render({ quiet: true }); setTimeout(() => $('form[data-form="link"] input').focus(), 0); break;
      case 'add-check': S.showForm = 'check'; render({ quiet: true }); break;
      case 'add-entry': S.showForm = 'entry'; render({ quiet: true }); break;
      case 'add-renewal': S.showForm = 'renewal'; render({ quiet: true }); break;
      case 'cancel-form': S.showForm = null; render({ quiet: true }); break;
      case 'del-link': await api('/links/' + id, { method: 'DELETE' }); toast('Link removed'); render({ quiet: true }); break;
      case 'del-entry': await api('/ledger/' + id, { method: 'DELETE' }); closePalette(); S.showForm = null; toast('Entry deleted'); render({ quiet: true }); break;
      case 'edit-entry': { const r = S.data.rows.find((x) => x.id === Number(id)); if (r) editEntryDialog(r); break; }
      case 'add-domain': S.showForm = 'domain'; render({ quiet: true }); setTimeout(() => { const i = $('form[data-form="domain"] input'); if (i) i.focus(); }, 0); break;
      case 'edit-domain': { const r = S.data.domains.find((x) => x.id === Number(id)); if (r) { S.palette = { mode: 'domain' }; $('#overlay').innerHTML = `<div class="scrim" data-act="scrim"><div class="dialog" role="dialog" aria-modal="true" aria-label="Edit domain">${domainForm(r, S.data).replace('class="card rise"', 'class="pad"').replace('margin-top:16px;', '')}</div></div>`; } break; }
      case 'del-domain': await api('/renewals/' + id, { method: 'DELETE' }); closePalette(); S.showForm = null; toast('Domain removed'); render({ quiet: true }); break;
      case 'fin-site': S.fin.site = v || ''; S.fin.limit = 50; render({ quiet: true }); break;
      case 'fin-kind': S.fin.kind = v; S.fin.limit = 50; render({ quiet: true }); break;
      case 'fin-more': S.fin.limit += 100; render({ quiet: true }); break;
      case 'add-recurring': S.billDraft = null; S.showForm = 'recurring'; render({ quiet: true }); break;
      case 'bill-preset': { const p = BILL_PRESETS[Number(t.dataset.i)]; const f = t.closest('form'); f.name.value = p.name; f.cadence.value = p.cadence; f.amount.focus(); f.querySelectorAll('.choice').forEach((c) => c.setAttribute('aria-pressed', String(c === t))); break; }
      case 'mark-renewed': await api(`/renewals/${id}/renewed`, { method: 'POST' }); toast('Renewed — cost added to the ledger'); render({ quiet: true }); break;
      case 'del-recurring': await api('/recurring/' + id, { method: 'DELETE' }); closePalette(); toast('Bill removed'); render({ quiet: true }); break;
      case 'edit-bill': { const r = S.data.recurring.find((x) => x.id === Number(id)); if (r) billDialog(r); break; }
      case 'del-renewal': await api('/renewals/' + id, { method: 'DELETE' }); render({ quiet: true }); break;
      case 'run-checks': await runChecksNow(); break;
      case 'resolve': await api(`/incidents/${id}/resolve`, { method: 'POST' }); render({ quiet: true }); break;
      case 'push-on': await enablePush(); break;
      case 'push-test': await api('/push/test', { method: 'POST' }); toast('Test alert sent'); break;
      case 'period': S.period = v; render({ quiet: true }); break;
      case 'new-project': projectDialog(null); break;
      case 'edit-project': projectDialog(S.data.project); break;
      case 'pick-color': { const input = t.previousElementSibling; input.checked = true; t.closest('.choices').querySelectorAll('.tile').forEach((x) => { x.style.outline = x === t ? '2px solid var(--text)' : 'none'; }); break; }
      case 'archive': await api('/projects/' + id, { method: 'PATCH', body: { archived: true } }); closePalette(); await loadProjects(); toast('Project archived'); location.hash = '#/projects'; break;
      case 'reload': render(); break;
      default: break;
    }
  } catch (err) { fail(err); }
});

document.addEventListener('change', async (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  try {
    if (t.dataset.act === 'todo') {
      const done = t.checked;
      await api('/notes/' + t.dataset.id, { method: 'PATCH', body: { done } });
      if (done) toast('To-do done', { undo: async () => { await api('/notes/' + t.dataset.id, { method: 'PATCH', body: { done: false } }); render({ quiet: true }); } });
      render({ quiet: true });
    }
    if (t.dataset.act === 'rec-on') { await api('/recurring/' + t.dataset.id, { method: 'PATCH', body: { active: t.checked } }); render({ quiet: true }); }
    if (t.dataset.act === 'check-on') {
      await api('/checks/' + t.dataset.id, { method: 'PATCH', body: { enabled: t.checked } });
      render({ quiet: true });
    }
  } catch (err) { fail(err); }
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(f));
  const btn = f.querySelector('button:not([type="button"])');
  if (btn) btn.disabled = true;
  try {
    switch (f.dataset.form) {
      case 'note': {
        const note = await api('/notes', { method: 'POST', body: { project_id: route().id, kind: S.kind, text: data.text } });
        toast('Note added', { undo: async () => { await api('/notes/' + note.id, { method: 'DELETE' }); render({ quiet: true }); } });
        render({ quiet: true });
        break;
      }
      case 'quick-note': {
        const P = S.palette;
        const project = S.projects.find((p) => p.id === P.project);
        const note = await api('/notes', { method: 'POST', body: { project_id: P.project, kind: P.kind || 'note', text: data.text } });
        closePalette();
        toast(`Note added to ${project ? project.name : 'project'}`, { undo: async () => { await api('/notes/' + note.id, { method: 'DELETE' }); render({ quiet: true }); } });
        render({ quiet: true });
        break;
      }
      case 'edit-note': await api('/notes/' + f.dataset.id, { method: 'PATCH', body: { text: data.text } }); S.editing = null; toast('Note saved'); render({ quiet: true }); break;
      case 'link': await api('/links', { method: 'POST', body: { project_id: route().id, ...data } }); S.showForm = null; toast('Link added'); render({ quiet: true }); break;
      case 'check': await api('/checks', { method: 'POST', body: data }); S.showForm = null; toast('Check added — it runs within a minute'); render({ quiet: true }); break;
      case 'entry': {
        if (f.dataset.id) { await api('/ledger/' + f.dataset.id, { method: 'PATCH', body: data }); closePalette(); toast('Entry saved'); }
        else { await api('/ledger', { method: 'POST', body: data }); S.showForm = null; toast('Entry saved'); }
        render({ quiet: true });
        break;
      }
      case 'domain': {
        const body = { ...data, auto: data.auto === '1' };
        if (f.dataset.id) { await api('/renewals/' + f.dataset.id, { method: 'PATCH', body }); closePalette(); toast('Domain saved'); }
        else { await api('/renewals', { method: 'POST', body }); S.showForm = null; toast('Domain added'); }
        render({ quiet: true });
        break;
      }
      case 'bill': await api('/recurring/' + f.dataset.id, { method: 'PATCH', body: data }); closePalette(); toast('Bill saved'); render({ quiet: true }); break;
      case 'recurring': await api('/recurring', { method: 'POST', body: data }); S.showForm = null; toast('Bill added'); render({ quiet: true }); break;
      case 'renewal': await api('/renewals', { method: 'POST', body: data }); S.showForm = null; render({ quiet: true }); break;
      case 'project': {
        const id = f.dataset.id;
        const body = { ...data };
        if (!body.initials) delete body.initials;
        const out = id ? await api('/projects/' + id, { method: 'PATCH', body }) : await api('/projects', { method: 'POST', body });
        closePalette();
        await loadProjects();
        toast(id ? 'Project saved' : 'Project added');
        location.hash = '#/p/' + out.project.id;
        render({ quiet: !!id });
        break;
      }
      default: break;
    }
  } catch (err) { fail(err); if (btn) btn.disabled = false; }
});

// Ledger search: filter as you type, keeping the cursor in the box.
let finTimer;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'fin-q') return;
  clearTimeout(finTimer);
  finTimer = setTimeout(async () => {
    S.fin.q = e.target.value; S.fin.limit = 50;
    await render({ quiet: true });
    const q = $('#fin-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }, 250);
});

// Keyboard: ⌘K / Ctrl+K search, N new note, Esc closes, ⌘↵ saves a note.
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); S.palette ? closePalette() : openPalette(); return; }
  if (e.key === 'Escape' && $('#overlay').innerHTML) { e.preventDefault(); closePalette(); return; }
  if (e.key === 'Escape' && S.editing) { e.preventDefault(); S.editing = null; render({ quiet: true }); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && e.target.tagName === 'TEXTAREA') { e.preventDefault(); e.target.form && e.target.form.requestSubmit(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || $('#overlay').innerHTML) return;
  const k = e.key.toLowerCase();
  if (S.gPending) {
    S.gPending = false;
    const to = { d: '#/', p: '#/projects', m: '#/monitoring', f: '#/finances' }[k];
    if (to) { e.preventDefault(); location.hash = to; }
    return;
  }
  if (k === 'g') { S.gPending = true; setTimeout(() => { S.gPending = false; }, 1200); return; }
  if (k === 'n') { e.preventDefault(); openPalette('note'); }
  if (k === '?') { e.preventDefault(); showShortcuts(); }
  if (k === 'r') { e.preventDefault(); render({ quiet: true }).then(() => toast('Up to date')); }
  if (k === 't') { e.preventDefault(); setTheme(!isDark()); render({ quiet: true }); }
});

window.addEventListener('hashchange', () => { S.showForm = null; S.editing = null; S.tab = 'notes'; S.fin.kind = 'all'; S.fin.q = ''; S.fin.limit = 50; closePalette(); render(); });

// Live: refresh quietly every 30 seconds while the page is open, and as soon as you come back to it.
const busy = () => S.palette || S.showForm || S.editing || document.hidden || document.activeElement.matches('input,textarea,select');
setInterval(() => { if (!busy()) render({ quiet: true }); }, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.loadedAt && Date.now() - S.loadedAt > 10_000 && !busy()) render({ quiet: true }); });
setInterval(() => {
  const el = $('#live-t'); if (!el || !S.loadedAt) return;
  const s = Math.round((Date.now() - S.loadedAt) / 1000);
  el.textContent = s < 10 ? 'Live' : s < 60 ? `Updated ${s}s ago` : `Updated ${Math.round(s / 60)} min ago`;
}, 5_000);

// Phone: pull down from the top to refresh.
(() => {
  let y0 = null, dy = 0;
  const ind = document.createElement('div'); ind.className = 'ptr'; ind.innerHTML = ICON.refresh; document.body.appendChild(ind);
  addEventListener('touchstart', (e) => { y0 = window.scrollY <= 0 && !$('#overlay').innerHTML ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    ind.style.transform = `translate(-50%, ${Math.min(dy, 110) * 0.6}px) rotate(${dy * 2.5}deg)`;
    ind.style.opacity = Math.min(1, dy / 80);
    ind.classList.toggle('ready', dy > 90);
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (y0 == null) return;
    const go = dy > 90; y0 = null;
    if (go) { ind.classList.add('spinning'); await render({ quiet: true }); }
    ind.classList.remove('spinning', 'ready'); ind.style.transform = ''; ind.style.opacity = 0;
  });
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
// First load: show a skeleton of the dashboard instead of a blank page.
app.innerHTML = `<div class="skel-page"><div class="sk" style="width:180px;height:14px"></div><div class="sk" style="width:340px;height:34px;margin:10px 0 28px"></div><div class="skel-grid"><div class="sk big"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div></div></div>`;
render();
