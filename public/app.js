// mazzagotte.dev hub — the app (no build step). Hash routes: #/ · #/projects · #/p/<id> · #/monitoring · #/finances
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

// ---------- state ----------
const S = {
  projects: [],
  collapsed: localStorage.getItem('side') === 'collapsed',
  filter: 'all',
  tab: 'notes',
  kind: 'note',
  period: 'month',
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

const I = (d, size = 18) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  dash: I('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  folder: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  money: I('<rect x="2" y="6" width="20" height="14" rx="2.5"/><path d="M2 10h20M16 15h2"/><path d="M6 6V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>'),
  gauge: I('<path d="M3.5 16a9 9 0 1 1 17 0"/><path d="m12 13 4-4"/><circle cx="12" cy="13" r="1"/>'),
  panel: I('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 16),
  plus: I('<path d="M12 5v14M5 12h14"/>', 16),
  sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: I('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  pin: I('<path d="M12 17v5"/><path d="M9 3h6l-1 7 4 3v2H6v-2l4-3z"/>', 16),
  trash: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 16),
  check: I('<path d="m5 12 5 5L20 7"/>', 22),
  x: I('<path d="M18 6 6 18M6 6l12 12"/>', 16),
  out: I('<path d="M7 17 17 7M8 7h9v9"/>', 12),
  refresh: I('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', 16),
  bell: I('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', 16),
  todo: I('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>'),
  edit: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', 16),
  emptyNote: I('<rect x="6" y="3" width="13" height="17" rx="2"/><path d="M9 8h7M9 11h7M9 14h4"/>', 40),
};

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
  $('#toast').innerHTML = `<div class="toast${error ? ' err' : ''}">${error ? '' : `<span style="color:#22C55E">${I('<path d="m5 12 5 5L20 7"/>', 18)}</span>`}<span>${esc(msg)}</span>${undo ? '<button data-act="undo">Undo</button>' : ''}</div>`;
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
    else if (r.view === 'finances') S.data = await api('/finances?period=' + S.period);
    else S.data = await api('/dashboard');
  } catch (e) {
    app.innerHTML = shell(r, `<div class="page"><div class="empty big"><b>Couldn't load this page</b><span>${esc(e.message)}</span><button class="btn" data-act="reload">Try again</button></div></div>`, 'Error');
    return;
  }
  const views = { dashboard: viewDashboard, projects: viewProjects, project: viewProject, monitoring: viewMonitoring, finances: viewFinances };
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
      <a class="nav${on('finances')}" href="#/finances" aria-label="Finances">${ICON.money}<span class="lbl">Finances</span></a>
    </nav>
    <div style="display:flex;flex-direction:column;gap:2px">
      <p class="sec">Projects</p>
      ${S.projects.map((p) => `<a class="nav${r.view === 'project' && r.id === p.id ? ' on' : ''}" href="#/p/${esc(p.id)}" aria-label="${esc(p.name)}"><span class="dotwrap"><span class="dot" style="background:${esc(p.color)}"></span></span><span class="lbl" style="overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span></a>`).join('')}
      <button class="nav" data-act="new-project" aria-label="Add project">${ICON.plus}<span class="lbl">Add project</span></button>
    </div>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:2px">
      <button class="nav" data-act="shortcuts" aria-label="Keyboard shortcuts">${I('<rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>')}<span class="lbl">Shortcuts</span><span class="kbd lbl" style="margin-left:auto">?</span></button>
      <button class="nav" data-act="theme" aria-label="${isDark() ? 'Switch to light mode' : 'Switch to dark mode'}">${isDark() ? ICON.sun : ICON.moon}<span class="lbl">${isDark() ? 'Light mode' : 'Dark mode'}</span></button>
    </div>
  </aside>
  <div class="main">
    <header class="top"><div class="top-in">
      <p class="crumb"><span class="ws">Workspace / </span><b>${esc(crumb)}</b></p>
      <div class="top-actions">
        <span class="live d-only" title="This page refreshes on its own"><span class="sdot pulse"></span><span id="live-t">Live</span></span>
        <button class="search-btn" data-act="palette" aria-label="Search or jump to (Command K)">${ICON.search}<span class="grow">Search or jump to…</span><span class="kbd hide-sm">⌘K</span></button>
        <button class="btn primary d-only" data-act="new-note">${ICON.plus}<span>New note</span><span class="kbd">N</span></button>
      </div>
    </div></header>
    ${content}
  </div>
</div>
<nav class="tabbar" aria-label="Tabs">
  <a href="#/" class="${on('dashboard').trim()}">${ICON.dash}Home</a>
  <a href="#/projects" class="${on('projects').trim()}">${ICON.folder}Projects</a>
  <div class="plus"><button data-act="new-note" aria-label="New note">${I('<path d="M12 5v14M5 12h14"/>', 24)}</button></div>
  <a href="#/monitoring" class="${on('monitoring').trim()}">${ICON.gauge}Status</a>
  <a href="#/finances" class="${on('finances').trim()}">${ICON.money}Money</a>
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

const projectRow = (p) => `<a class="prow" href="#/p/${esc(p.id)}">${tile(p)}<span class="grow"><b>${esc(p.name)}</b><span>${p.latest ? esc(p.latest.text) : esc(p.type)}</span></span>${pill(p.status)}<span class="chev">${I('<path d="m9 6 6 6-6 6"/>', 16)}</span></a>`;

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
        <div class="stat"><b>${f.open_todos}</b><span>Open to-dos</span></div>
        <div class="stat"><b>${(f.links || []).length}</b><span>Links</span></div>
        <div class="stat"><b>${esc(f.hosting || '—')}</b><span>Hosting</span></div>
      </div>
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:auto">${(f.links || []).slice(0, 3).map((l) => `<a class="chip" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ${ICON.out}</a>`).join('')}<a class="btn dark" style="margin-left:auto" href="#/p/${esc(f.id)}">Open project →</a></div>
    </article>` : ''}
    <section class="card span2 rows2 rise o3" aria-labelledby="act-h"><div class="card-head"><h2 id="act-h">Latest activity</h2><span class="muted">Newest first</span></div>
      <ol class="feed">${d.events.map((e, i) => `<li><span class="ring${i === 0 ? ' fill' : ''}" style="--c:${esc(e.color || (e.level === 'bad' ? 'var(--bad)' : 'var(--hover)'))}"></span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span class="who"><b>${esc(e.project_name || 'Hub')}</b><span class="muted" style="flex:none;font-size:12px">${esc(rel(e.created_at))}</span></span><span class="what">${esc(e.text)}</span></span></li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ol>
    </section>
    <section class="card span3 rise d-only" aria-labelledby="st-h">
      <div class="card-head"><h2 id="st-h">Site status</h2><span class="row" style="gap:12px;font-size:12px">${known.length ? (down.length ? `<span class="row" style="gap:6px;color:var(--bad);font-weight:500"><span class="sdot bad"></span>${down.length} down</span>` : '<span class="row" style="gap:6px;font-weight:500"><span class="sdot glow"></span>All up</span>') : '<span class="muted">Waiting for first check</span>'}<a href="#/monitoring" style="font-size:13px">Monitoring →</a></span></div>
      <div class="rows">${enabled.map((c) => { const p = projectName[c.project_id] || {}; return `<a href="#/monitoring" class="row" style="padding:9px 0;color:var(--text)"><span class="sdot ${!c.last_at ? 'unk' : c.last_ok ? '' : 'bad'}"></span><span style="flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3"><span style="font-size:14px;font-weight:500">${esc(p.name || c.project_id)}</span><span class="mono muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(host(c.url))}</span></span><span class="spk ${c.last_at && !c.last_ok ? 'down' : ''}">${spark(c.spark || [], { w: 72, h: 22 })}</span><span class="muted num" style="font-size:12px;min-width:64px;text-align:right">${c.last_at ? (c.last_ok ? `${c.last_ms} ms` : esc(c.last_error || 'Down')) : '—'}</span></a>`; }).join('')}</div>
    </section>
    <section class="card span3 rise o4" aria-labelledby="mo-h" style="display:flex;flex-direction:column;gap:14px">
      <div class="card-head" style="margin:0"><h2 id="mo-h">Money · this month</h2><a href="#/finances" style="font-size:13px">Finances →</a></div>
      ${m.income || m.costs ? `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
        <div class="stat"><span>Income</span><b style="font-size:22px">${money(m.income)}</b></div>
        <div class="stat"><span>Costs</span><b style="font-size:22px">${money(m.costs)}</b></div>
        <div class="stat"><span>Net</span><b style="font-size:22px">${money(m.net)}</b></div></div>`
        : `<div class="empty">Nothing recorded this month. Tournament Central's $5 charges land here automatically once payments are on; add costs on the Finances page.</div>`}
      ${d.renewal ? `<p class="muted" style="margin:0;font-size:13px">Next renewal: <span class="mono" style="color:var(--text2)">${esc(d.renewal.domain)}</span> · ${esc(dateLabel(d.renewal.renews_on))}</p>` : ''}
    </section>
    <section class="card span3 rise o1" aria-labelledby="td-h"><div class="card-head"><h2 id="td-h">To do</h2><span class="muted">${openTodos} open</span></div>
      ${d.todos.map((t) => todoRow(t, true)).join('') || '<p class="muted" style="margin:8px 0 0;font-size:14px">No to-dos. Add one with a note tagged “To do”.</p>'}
    </section>
    <section class="card span3 rise d-only" aria-labelledby="ql-h"><div class="card-head"><h2 id="ql-h">Quick links</h2></div>
      ${allLinks.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener" class="row" style="min-height:40px;border-top:1px solid var(--border);color:var(--text2);font-size:14px;gap:10px"><span class="dot" style="width:8px;height:8px;border-radius:2px;background:${esc(l.color)}"></span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(host(l.url))}</span><span class="muted">↗</span></a>`).join('')}
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
    <div class="row acts" style="gap:10px;flex-wrap:wrap;align-items:flex-start"><button class="btn" data-act="edit-project">Edit project</button>${p.status !== 'planned' && d.links[0] ? `<a class="btn primary" href="${esc(d.links[0].url)}" target="_blank" rel="noopener">Open ${esc(d.links[0].label.toLowerCase())} ↗</a>` : ''}</div>
  </div>
  <section aria-label="Quick links" class="rise qlinks" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-bottom:32px">
    ${d.links.map((l) => `<a class="qlink" href="${esc(l.url)}" target="_blank" rel="noopener"><span class="l">${esc(l.label)}</span><span class="u">${esc(host(l.url))} ↗</span></a>`).join('')}
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
          <div class="row kinds" role="group" aria-label="Note type" style="gap:6px;flex-wrap:wrap">${kinds.map((k) => `<button type="button" class="kind" aria-pressed="${S.kind === k}" data-act="kind" data-v="${k}">${KIND_LABEL[k]}</button>`).join('')}</div>
          <button class="btn primary">Add note <span class="kbd">⌘↵</span></button>
        </div>
      </form>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${notes.map((n) => `<article class="note-card rise${n.kind === 'todo' && n.done ? ' done' : ''}">
          <div style="flex:1;min-width:0"><div class="meta"><span class="tag k-${n.kind}">${KIND_LABEL[n.kind]}</span>${n.pinned ? '<span style="font-weight:500;color:var(--body)">Pinned</span>' : ''}<span>· ${esc(rel(n.created_at))}</span>${n.kind === 'todo' ? `<label class="row" style="gap:6px;margin-left:auto;cursor:pointer"><input type="checkbox" data-act="todo" data-id="${n.id}" ${n.done ? 'checked' : ''} style="accent-color:var(--accent)"> Done</label>` : ''}</div>${S.editing === n.id ? `<form data-form="edit-note" data-id="${n.id}" class="edit-note"><label class="sr" for="en-${n.id}">Edit note</label><textarea class="input" id="en-${n.id}" name="text" rows="3" required maxlength="2000">${esc(n.text)}</textarea><div class="row" style="justify-content:flex-end;gap:8px;margin-top:8px"><button type="button" class="btn small" data-act="cancel-edit">Cancel</button><button class="btn small primary">Save <span class="kbd">⌘↵</span></button></div></form>` : `<p class="fmt" data-act="edit-note" data-id="${n.id}" title="Click to edit">${fmt(n.text)}</p>`}</div>
          <div class="acts"><button class="icon-btn" data-act="edit-note" data-id="${n.id}" aria-label="Edit note" title="Edit">${ICON.edit}</button><button class="icon-btn${n.pinned ? ' pinned-on' : ''}" data-act="pin" data-id="${n.id}" data-v="${n.pinned ? 0 : 1}" aria-pressed="${!!n.pinned}" aria-label="${n.pinned ? 'Unpin note' : 'Pin note'}" title="${n.pinned ? 'Unpin' : 'Pin'}">${ICON.pin}</button><button class="icon-btn" data-act="del-note" data-id="${n.id}" aria-label="Delete note" title="Delete">${ICON.trash}</button></div>
        </article>`).join('') || `<div class="empty big">${ICON.emptyNote}<b style="color:var(--text)">A clean slate</b><span>Jot down where you left off, a bug to fix, or an idea.</span></div>`}
      </div>` : `
      <div class="card" style="padding:0;overflow:hidden">${d.links.map((l) => `<div class="row" style="padding:14px 18px;border-bottom:1px solid var(--border)"><div style="flex:1;min-width:0"><p style="margin:0;font-weight:500;font-size:14px">${esc(l.label)}</p><p class="mono muted" style="margin:2px 0 0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.url)}</p></div><a href="${esc(l.url)}" target="_blank" rel="noopener" style="font-weight:500;font-size:14px">Open ↗</a><button class="icon-btn" data-act="del-link" data-id="${l.id}" aria-label="Delete link ${esc(l.label)}">${ICON.trash}</button></div>`).join('')}
        <div style="padding:14px 18px"><button class="btn small" data-act="add-link">+ Add a link</button></div></div>`}
    </section>
    <aside class="narrow">
      <div class="card"><h2 style="margin-bottom:4px">Open to-dos</h2><p class="muted" style="margin:0 0 6px;font-size:13px">From this project's “To do” notes</p>${open.map((t) => `<p style="margin:0;padding:10px 0;border-top:1px solid var(--border);font-size:14px;color:var(--text2)">${esc(t.text)}</p>`).join('') || '<p class="muted" style="margin:0;padding:10px 0;border-top:1px solid var(--border);font-size:14px">All clear.</p>'}</div>
      <div class="card"><h2 style="margin-bottom:8px">Activity</h2>${d.events.map((e) => `<p style="margin:0;padding:8px 0;border-top:1px solid var(--border);font-size:13px;color:var(--text2);display:flex;justify-content:space-between;gap:10px"><span style="min-width:0;overflow-wrap:anywhere">${esc(e.text)}</span><span class="muted" style="flex:none">${esc(rel(e.created_at))}</span></p>`).join('') || '<p class="muted" style="margin:0;font-size:13px">Nothing yet.</p>'}</div>
      ${d.incidents.length ? `<div class="card"><h2 style="margin-bottom:8px">Incidents</h2>${d.incidents.map((i) => `<p style="margin:0;padding:8px 0;border-top:1px solid var(--border);font-size:13px"><span class="pill ${i.resolved_at ? 'up' : 'down'}" style="margin-right:6px">${i.resolved_at ? 'Resolved' : 'Open'}</span>${esc(i.title)} · <span class="muted">${esc(rel(i.started_at))}</span></p>`).join('')}</div>` : ''}
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
    <span class="badge${down.length ? ' bad' : waiting === enabled.length ? ' wait' : ''}" aria-hidden="true">${down.length ? I('<path d="M12 8v5M12 16h.01"/><circle cx="12" cy="12" r="9"/>', 22) : waiting === enabled.length ? I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 22) : ICON.check}</span>
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
    <section class="card wide" aria-labelledby="inc-h"><h2 id="inc-h" style="margin-bottom:10px">Incidents</h2>
      ${d.incidents.map((i) => `<div style="border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-top:10px"><div class="row" style="flex-wrap:wrap;gap:8px 10px"><span class="pill ${i.resolved_at ? 'up' : 'down'}">${i.resolved_at ? 'Resolved' : 'Open'}</span><span class="row" style="gap:6px;font-size:13px;font-weight:500"><span class="dot" style="width:8px;height:8px;border-radius:2px;background:${esc(i.color || '#52525B')}"></span>${esc(i.project_name || 'Hub')}</span><span class="muted" style="margin-left:auto;font-size:12px">${esc(rel(i.started_at))}${i.resolved_at ? ` · lasted ${Math.max(1, Math.round((i.resolved_at - i.started_at) / 60000))} min` : ''}</span></div><p style="margin:8px 0 0;font-weight:600">${esc(i.title)}</p>${i.detail ? `<p class="muted" style="margin:2px 0 0;font-size:14px">${esc(i.detail)}</p>` : ''}${i.resolved_at ? '' : `<button class="btn small" style="margin-top:10px" data-act="resolve" data-id="${i.id}">Mark resolved</button>`}</div>`).join('') || '<p class="muted" style="margin:0;font-size:14px">No incidents yet.</p>'}
    </section>
    <section class="card narrow" aria-labelledby="ch-h" style="display:block"><div class="card-head"><h2 id="ch-h">Checks</h2><button class="btn small" data-act="add-check">+ Add</button></div>
      ${S.showForm === 'check' ? `<form data-form="check" style="display:flex;flex-direction:column;gap:10px;margin:10px 0"><label class="field"><span>Project</span><select class="input" name="project_id">${d.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><label class="field"><span>Name</span><input class="input" name="name" required maxlength="40" placeholder="Health"></label><label class="field"><span>Address to call</span><input class="input" name="url" type="url" required placeholder="https://…/health"></label><label class="field"><span>Text that must appear (optional)</span><input class="input" name="expect_text" maxlength="120"></label><div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn small" data-act="cancel-form">Cancel</button><button class="btn small primary">Save check</button></div></form>` : ''}
      ${d.checks.map((c) => `<div class="row" style="padding:10px 0;border-top:1px solid var(--border);gap:10px"><span class="dot" style="width:8px;height:8px;border-radius:2px;background:${esc((proj[c.project_id] || {}).color || '#52525B')}"></span><span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font-size:14px">${esc((proj[c.project_id] || {}).name || c.project_id)} · ${esc(c.name)}</span><span class="mono muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.url)}</span></span><input type="checkbox" class="switch" role="switch" aria-label="Check ${esc(c.name)} on" data-act="check-on" data-id="${c.id}" ${c.enabled ? 'checked' : ''}></div>`).join('')}
    </section>
  </div>
</div>`;
  return { crumb: 'Monitoring', html };
}

// ---------- finances ----------
function viewFinances(d) {
  const t = d.totals;
  const per = d.period === 'year' ? 'this year' : 'this month';
  const months = [];
  const base = new Date(d.today.slice(0, 7) + '-15T12:00:00Z');
  for (let i = 5; i >= 0; i--) { const x = new Date(base); x.setUTCMonth(x.getUTCMonth() - i); months.push(x.toISOString().slice(0, 7)); }
  const inc = Object.fromEntries(months.map((m) => [m, 0]));
  for (const h of d.history) if (h.kind === 'income' && h.month in inc) inc[h.month] = h.cents;
  const max = Math.max(1, ...Object.values(inc)) * 1.15;
  const byP = {};
  for (const r of d.by_project) {
    const k = r.project_id || '_';
    byP[k] ||= { name: r.name || 'Shared / unassigned', color: r.color || '#71717A', income: 0, costs: 0 };
    if (r.kind === 'income') byP[k].income += r.cents; else byP[k].costs += r.cents;
  }
  const prows = Object.values(byP).sort((a, b) => b.income - a.income || b.costs - a.costs);
  const next = d.renewals.find((r) => r.renews_on >= d.today);
  const html = `<div class="page">
  <div class="page-head rise"><div><h1 class="d-only">Finances</h1><p>What each site earns and costs.</p></div>
    <div class="row" style="gap:10px;flex-wrap:wrap"><div class="seg" role="group" aria-label="Period"><button class="${d.period === 'month' ? 'on' : ''}" aria-pressed="${d.period === 'month'}" data-act="period" data-v="month">Month</button><button class="${d.period === 'year' ? 'on' : ''}" aria-pressed="${d.period === 'year'}" data-act="period" data-v="year">Year</button></div>
    <a class="btn" href="/api/ledger.csv" download>Export CSV</a><button class="btn primary" data-act="add-entry">${ICON.plus}Add entry</button></div></div>
  ${S.showForm === 'entry' ? `<form class="card rise" data-form="entry" style="margin-bottom:16px;display:flex;flex-direction:column;gap:12px"><h2>Add an entry</h2>
    <div class="form-row"><label class="field" style="flex:2 1 240px"><span>What is it?</span><input class="input" name="description" required maxlength="200" placeholder="Railway — November usage"></label><label class="field"><span>Amount (USD)</span><input class="input" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required placeholder="0.00"></label><label class="field"><span>Date</span><input class="input" name="occurred_on" type="date" value="${esc(d.today)}"></label></div>
    <div class="form-row"><label class="field"><span>Type</span><select class="input" name="kind"><option value="cost">Cost</option><option value="income">Income</option><option value="fee">Fee</option><option value="refund">Refund</option></select></label><label class="field"><span>Site</span><select class="input" name="project_id"><option value="">Shared / none</option>${d.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label></div>
    <div class="row" style="justify-content:flex-end;gap:10px"><button type="button" class="btn" data-act="cancel-form">Cancel</button><button class="btn primary">Save entry</button></div></form>` : ''}
  <div class="kpis rise">
    <div class="kpi"><p class="l">Income ${per}</p><p class="v">${money(t.income)}</p><p class="s">Tournament Central $5 fees</p></div>
    <div class="kpi"><p class="l">Costs ${per}</p><p class="v">${money(t.costs)}</p><p class="s">Hosting, domains, Stripe fees</p></div>
    <div class="kpi"><p class="l">Net ${per}</p><p class="v">${money(t.net)}</p><p class="s">${t.net >= 0 ? 'Income covers costs' : 'Costs exceed income'}</p></div>
    <div class="kpi"><p class="l">Next renewal</p><p class="v mono" style="font-size:18px;padding-top:6px">${next ? esc(next.domain) : '—'}</p><p class="s">${next ? `${esc(dateLabel(next.renews_on))} · ${money(next.price_cents)}` : 'Add your domains below'}</p></div>
  </div>
  <div class="split" style="margin-top:16px">
    <section class="card wide" aria-labelledby="inc-h"><div class="card-head"><h2 id="inc-h">Income by month</h2><span class="muted">Last 6 months</span></div>
      <div class="bars" role="img" aria-label="${esc('Income by month: ' + months.map((m) => `${m} ${money(inc[m])}`).join(', '))}" style="margin-top:12px">${months.map((m, i) => `<div class="col${i === 5 ? ' last' : ''}"><span class="val">${money(inc[m])}</span><span class="bar" style="height:${((inc[m] / max) * 100).toFixed(1)}%"></span></div>`).join('')}</div>
      <div class="months">${months.map((m) => `<span>${new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short' })}</span>`).join('')}</div>
    </section>
    <section class="card narrow" aria-labelledby="bp-h" style="display:block"><h2 id="bp-h" style="margin-bottom:8px">By site · ${per}</h2>
      ${prows.map((r) => `<div class="row" style="padding:10px 0;border-top:1px solid var(--border);gap:10px"><span class="dot" style="background:${esc(r.color)}"></span><span style="flex:1;font-size:14px">${esc(r.name)}</span><span style="font-size:13px;text-align:right"><span style="font-weight:600">${money(r.income - r.costs)}</span><br><span class="muted">${money(r.income)} in · ${money(r.costs)} out</span></span></div>`).join('') || '<p class="muted" style="margin:0;font-size:14px">Nothing recorded yet.</p>'}
    </section>
  </div>
  <div class="split" style="margin-top:16px">
    <section class="card wide" style="padding:0;overflow:hidden" aria-labelledby="led-h"><div class="card-head" style="padding:18px 20px 6px"><h2 id="led-h">Ledger</h2><span class="muted">Newest first</span></div>
      <div class="m-only" style="padding:0 16px 6px">${d.rows.map((r) => `<div class="lrow"><span class="grow"><b>${esc(r.description)}</b><span>${esc(dateLabel(r.occurred_on))} · ${esc(r.project_name || 'Shared')} · ${esc(r.kind)}</span></span><b style="font-size:14px;color:${r.kind === 'income' ? 'var(--good)' : 'inherit'}">${r.kind === 'income' ? '+' : '−'}${money(r.amount_cents).replace('−', '')}</b>${r.source === 'manual' ? `<button class="icon-btn" data-act="del-entry" data-id="${r.id}" aria-label="Delete entry">${ICON.trash}</button>` : ''}</div>`).join('') || '<p class="muted" style="font-size:14px">No entries yet.</p>'}</div><div class="table-wrap collapse"><table class="t" style="min-width:560px"><thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col">Site</th><th scope="col" class="num">Amount</th><th scope="col"><span class="sr">Delete</span></th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td class="muted" style="white-space:nowrap">${esc(dateLabel(r.occurred_on))}</td><td>${esc(r.description)} <span class="muted" style="font-size:12px">· ${esc(r.kind)}${r.source !== 'manual' ? ' · ' + esc(r.source) : ''}</span></td><td>${esc(r.project_name || '—')}</td><td class="num" style="font-weight:500;color:${r.kind === 'income' ? 'var(--good)' : 'inherit'}">${r.kind === 'income' ? '+' : '−'}${money(r.amount_cents).replace('−', '')}</td><td style="width:44px">${r.source === 'manual' ? `<button class="icon-btn" data-act="del-entry" data-id="${r.id}" aria-label="Delete entry">${ICON.trash}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No entries yet.</td></tr>'}
      </tbody></table></div></section>
    <section class="card narrow" aria-labelledby="ren-h" style="display:block"><div class="card-head"><h2 id="ren-h">Domain renewals</h2><button class="btn small" data-act="add-renewal">+ Add</button></div>
      ${S.showForm === 'renewal' ? `<form data-form="renewal" style="display:flex;flex-direction:column;gap:10px;margin:10px 0"><label class="field"><span>Domain</span><input class="input mono" name="domain" required placeholder="tournamentcentral.app"></label><div class="form-row"><label class="field"><span>Renews on</span><input class="input" type="date" name="renews_on" required></label><label class="field"><span>Price (USD)</span><input class="input" type="number" min="0" step="0.01" name="price"></label></div><label class="field"><span>Site</span><select class="input" name="project_id"><option value="">None</option>${d.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn small" data-act="cancel-form">Cancel</button><button class="btn small primary">Save</button></div></form>` : ''}
      ${d.renewals.map((r) => `<div class="row" style="padding:10px 0;border-top:1px solid var(--border);gap:10px"><span style="flex:1;min-width:0;display:flex;flex-direction:column"><span class="mono" style="font-size:14px;font-weight:500">${esc(r.domain)}</span><span class="muted" style="font-size:12px">${esc(dateLabel(r.renews_on))}${r.project_name ? ' · ' + esc(r.project_name) : ''}</span></span><span style="font-size:14px;font-weight:500">${money(r.price_cents)}</span><button class="icon-btn" data-act="del-renewal" data-id="${r.id}" aria-label="Delete renewal">${ICON.trash}</button></div>`).join('') || '<p class="muted" style="margin:6px 0 0;font-size:14px">Add each domain once; the hub shows the next one due.</p>'}
    </section>
  </div>
</div>`;
  return { crumb: 'Finances', html };
}

// ---------- command palette + quick note ----------
function paletteItems() {
  const q = (S.palette.q || '').trim().toLowerCase();
  const m = (s) => !q || s.toLowerCase().includes(q);
  const actions = [
    { label: 'New note', hint: 'N', run: () => { S.palette.mode = 'note'; drawPalette(); } },
    { label: isDark() ? 'Switch to light mode' : 'Switch to dark mode', hint: '', run: () => { setTheme(!isDark()); closePalette(); render({ quiet: true }); } },
    { label: 'Run uptime checks now', hint: '', run: () => { closePalette(); location.hash = '#/monitoring'; runChecksNow(); } },
    { label: 'Add an expense', hint: '', run: () => { closePalette(); S.showForm = 'entry'; location.hash = '#/finances'; render(); } },
    { label: 'Keyboard shortcuts', hint: '?', run: () => { closePalette(); showShortcuts(); } },
  ].filter((a) => m(a.label));
  const pages = [['Dashboard', '#/'], ['Projects', '#/projects'], ['Monitoring', '#/monitoring'], ['Finances', '#/finances']]
    .filter(([l]) => m(l)).map(([label, href]) => ({ label, href }));
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
      <div class="row" style="flex-wrap:wrap;justify-content:space-between;gap:10px"><div class="row kinds" role="group" aria-label="Note type" style="gap:6px;flex-wrap:wrap">${['note', 'todo', 'idea', 'rule'].map((k) => `<button type="button" class="kind" aria-pressed="${(P.kind || 'note') === k}" data-act="qn-kind" data-v="${k}">${KIND_LABEL[k]}</button>`).join('')}</div>
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
    const icon = it.p ? tile(it.p, 'sm') : `<span class="tile sm" style="background:var(--subtle);color:var(--body)" aria-hidden="true">${it.href ? '→' : '+'}</span>`;
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
const SHORTCUTS = [['⌘ K', 'Search or run a command'], ['N', 'New note'], ['G then D', 'Go to Dashboard'], ['G then P', 'Go to Projects'], ['G then M', 'Go to Monitoring'], ['G then F', 'Go to Finances'], ['R', 'Refresh now'], ['T', 'Light / dark mode'], ['⌘ ↵', 'Save a note'], ['Esc', 'Close or cancel'], ['?', 'This list']];
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
      case 'del-entry': await api('/ledger/' + id, { method: 'DELETE' }); toast('Entry deleted'); render({ quiet: true }); break;
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
      case 'entry': await api('/ledger', { method: 'POST', body: data }); S.showForm = null; toast('Entry saved'); render({ quiet: true }); break;
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

window.addEventListener('hashchange', () => { S.showForm = null; S.editing = null; S.tab = 'notes'; closePalette(); render(); });

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
