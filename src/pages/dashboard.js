import { ext, inExtension } from '../lib/ext.js';
import { getSettings, saveSettings, loadState, markSeen, clearAll, bytesInUse } from '../lib/store.js';
import { runRefresh } from '../lib/refresh.js';
import { diffSnapshots } from '../lib/diff.js';
import { buildView, KINDS, digestEntry, isDone } from '../lib/feed.js';
import { formatDay, formatTime, formatRelative, toISODate, fromISODate, startOfDay, DAY_MS } from '../lib/dates.js';
import { urls } from '../lib/config.js';
import { translationAvailable, toEnglish, probablyNotEnglish } from '../lib/translate.js';

const params = new URLSearchParams(location.search);
// Outside the extension (page opened from disk or a dev server) show made-up demo data.
const DEMO = !inExtension;
const FEED_WINDOW_DAYS = 60;
const CLAMP_CHARS = 600;

const state = {
  settings: null,
  latest: null,
  baseline: null,
  history: [],
  status: {},
  view: null,
  tab: 'actions',
  busy: false,
  filters: {}, // childId -> { kind: 'all', onlyNew: false, showOlder: false }
  expanded: new Set(),
};

const $ = (sel) => document.querySelector(sel);

// Tiny DOM builder. Text is always set via text nodes, never innerHTML: all content comes from
// the portal and must not be interpreted as markup.
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function externalIcon() {
  return $('#icon-external').content.firstElementChild.cloneNode(true);
}

// --- State -------------------------------------------------------------------------------------

async function load() {
  state.settings = await getSettings();
  const school = params.get('school');
  if (school && school !== state.settings.school) state.settings = await saveSettings({ school });
  if (state.settings.school) Object.assign(state, await loadState(state.settings.school));
  else Object.assign(state, { latest: null, baseline: null, history: [], status: {} });
  computeView();
}

function computeView() {
  if (!state.latest) { state.view = null; return; }
  const diff = diffSnapshots(state.baseline, state.latest, { lookbackDays: state.settings.firstRunLookbackDays });
  state.view = buildView(state.latest, diff, state.settings);
  state.view.comparedTo = diff.comparedTo;
}

async function setBadge() {
  if (!inExtension || !ext.action) return;
  const n = state.view?.total || 0;
  // Each call separately: Safari lacks some of these.
  const calls = [
    () => ext.action.setBadgeBackgroundColor({ color: '#1f6a58' }),
    () => ext.action.setBadgeText({ text: n ? String(Math.min(n, 99)) : '' }),
    () => ext.action.setTitle({ title: n ? `Parent Digest: ${n} new or changed` : 'Open Parent Digest' }),
  ];
  for (const call of calls) {
    try { await call(); } catch { /* unsupported */ }
  }
}

// --- Actions -----------------------------------------------------------------------------------

async function refresh() {
  if (state.busy) return;
  const school = state.settings.school;
  if (!school) { openSettings(); return; }
  state.busy = true;
  renderChrome();
  const prog = $('#progress');
  prog.hidden = false;
  const onProgress = ({ label, done, total }) => {
    prog.querySelector('.bar span').style.width = `${Math.round((done / Math.max(total, 1)) * 100)}%`;
    prog.querySelector('.label').textContent = label;
  };
  try {
    if (DEMO) {
      for (let i = 0; i <= 10; i++) { onProgress({ label: 'Demo mode: nothing is fetched', done: i, total: 10 }); await new Promise((r) => setTimeout(r, 60)); }
    } else {
      await runRefresh({ school, settings: state.settings, onProgress });
    }
  } catch (e) {
    console.warn('Refresh failed:', e);
  } finally {
    state.busy = false;
    prog.hidden = true;
    await load();
    render();
    setBadge();
  }
}

async function markAllSeen() {
  if (!state.latest || state.busy) return;
  const entry = state.view?.total ? digestEntry(state.view, state.latest) : null;
  await markSeen(state.settings.school, entry);
  await load();
  render();
  setBadge();
}

// --- Rendering: chrome -------------------------------------------------------------------------

function render() {
  renderChrome();
  renderBanner();
  renderTabs();
  renderPanel();
  renderDiagnostics();
}

function renderChrome() {
  const s = state.settings;
  const sub = [];
  if (DEMO) sub.push('Demo data');
  sub.push(s.school || 'No school set');
  if (state.status.lastRefresh) sub.push(`Updated ${formatRelative(state.status.lastRefresh)}`);
  else if (state.latest) sub.push(`Updated ${formatRelative(state.latest.takenAt)}`);
  $('#subtitle').textContent = sub.join(' · ');
  $('#refreshBtn').disabled = state.busy;
  $('#refreshBtn').textContent = state.busy ? 'Refreshing…' : 'Refresh';
  $('#seenBtn').disabled = state.busy || !state.view || !state.view.total;
  $('#historyBtn').hidden = !state.history.length;
}

function renderBanner() {
  const box = $('#banner');
  box.replaceChildren();
  const s = state.status;
  const add = (cls, title, text, action) =>
    box.append(h('div', { class: `banner ${cls}` }, h('div', { class: 'b-text' }, h('strong', { text: title }), text && h('p', { text })), action));

  if (!state.settings.school) {
    add('', 'Set up', 'Open your Veracross parent portal in this browser and click the extension icon there, or enter your school route in Settings.',
      h('button', { class: 'btn small', type: 'button', onclick: openSettings, text: 'Settings' }));
    return;
  }
  if (s.lastErrorKind === 'session') {
    add('error', 'Please log in to Veracross', 'Your session has expired. Log in to the portal in this browser, then refresh. This extension never asks for or stores your password.',
      h('a', { class: 'btn small', href: urls.parentHome(state.settings.school), target: '_blank', rel: 'noopener', text: 'Open portal' }));
  } else if (s.lastError) {
    add('error', 'The last refresh failed', s.lastError);
  }
  const warnCount = (state.latest?.warnings?.length || 0) + (state.latest?.errors?.length || 0) +
    (state.latest?.children || []).reduce((n, c) => n + c.errors.length, 0);
  if (state.latest && warnCount) {
    add('warn', `${warnCount} part${warnCount === 1 ? '' : 's'} of the portal didn’t load cleanly`, 'The digest may be incomplete. See Diagnostics at the bottom of the page.',
      h('button', { class: 'btn small', type: 'button', text: 'Show', onclick: () => { $('#diagnostics').open = true; $('#diagnostics').scrollIntoView({ behavior: 'smooth' }); } }));
  }
}

function renderTabs() {
  const nav = $('#tabs');
  nav.replaceChildren();
  const tabs = [{ id: 'actions', label: 'Action items', count: state.view ? state.view.total : 0 }];
  const firstName = (n) => (n.includes(',') ? n.split(',')[1] : n).trim().split(/\s+/)[0] || n;
  const kids = state.view?.children || [];
  const firsts = kids.map((c) => firstName(c.name));
  kids.forEach((c, i) => {
    // First names only, unless two children would share a label.
    const label = firsts.filter((f) => f === firsts[i]).length > 1 ? c.name : firsts[i];
    tabs.push({ id: `child-${c.id}`, label, title: c.name, count: c.newCount });
  });
  if (!tabs.some((t) => t.id === state.tab)) state.tab = 'actions';
  for (const t of tabs) {
    const selected = t.id === state.tab;
    nav.append(h('button', {
      class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(selected), title: t.title, tabindex: selected ? '0' : '-1',
      onclick: () => selectTab(t.id),
      onkeydown: (e) => {
        const ids = tabs.map((x) => x.id);
        const i = ids.indexOf(t.id);
        if (e.key === 'ArrowRight') selectTab(ids[(i + 1) % ids.length], true);
        if (e.key === 'ArrowLeft') selectTab(ids[(i - 1 + ids.length) % ids.length], true);
      },
    }, t.label, t.count ? h('span', { class: 'count hot', text: t.count > 99 ? '99+' : String(t.count) }) : null));
  }
}

function selectTab(id, focus = false) {
  state.tab = id;
  history.replaceState(null, '', `${location.search}#${id}`);
  renderTabs();
  renderPanel();
  if (focus) $('#tabs [aria-selected="true"]')?.focus();
}

function renderPanel() {
  const panel = $('#panel');
  panel.replaceChildren();
  if (!state.view) { panel.append(firstRunEmpty()); return; }
  if (state.tab === 'actions') panel.append(actionsTab());
  else {
    const child = state.view.children.find((c) => `child-${c.id}` === state.tab);
    if (child) panel.append(childTab(child));
  }
}

function firstRunEmpty() {
  const school = state.settings.school;
  return h('div', { class: 'empty' },
    h('h3', { text: school ? 'Ready for your first digest' : 'Almost ready' }),
    h('p', { text: school
      ? `Make sure you're logged in to the Veracross portal in this browser, then refresh. The first refresh reads every class for every child — about a minute, done slowly on purpose.`
      : 'Tell the extension which school portal to read.' }),
    school
      ? h('button', { class: 'btn primary', type: 'button', onclick: refresh, text: 'Refresh now' })
      : h('button', { class: 'btn primary', type: 'button', onclick: openSettings, text: 'Open settings' }));
}

// --- Rendering: Action items -------------------------------------------------------------------

function actionsTab() {
  const v = state.view;
  const a = v.action;
  const frag = document.createDocumentFragment();
  const needIds = new Set(a.needs.map((i) => i.id));

  const seenDay = v.comparedTo ? formatDay(new Date(v.comparedTo)) : null;
  const since = seenDay
    ? `since you marked everything seen ${/^(Today|Yesterday)$/.test(seenDay) ? seenDay.toLowerCase() : `on ${seenDay}`}`
    : `in the last ${state.settings.firstRunLookbackDays} days (first run)`;
  frag.append(h('div', { class: 'summary-strip' },
    stat(a.needs.length, 'need attention'),
    stat(v.total, `new or changed ${v.comparedTo ? 'since last seen' : 'recently'}`),
    stat(a.upcoming.filter((i) => !isDone(i.status)).length, `due in the next ${state.settings.dueSoonDays} days`)));

  if (a.needs.length) {
    frag.append(section('Needs attention', 'Picked out by keywords and changes. Check the originals.', h('div', { class: 'stack' }, a.needs.map((it) => card(it, { showChild: true, reason: it.reason })))));
  }

  const groups = a.whatsNew.map((g) => ({ ...g, items: g.items.filter((i) => !needIds.has(i.id)) })).filter((g) => g.items.length);
  const msgs = a.newMessages.filter((m) => !needIds.has(m.id));
  if (groups.length || msgs.length) {
    const body = document.createDocumentFragment();
    for (const g of groups) {
      if (groups.length > 1 || state.view.children.length > 1) body.append(h('h3', { class: 'child-heading', text: g.child.name }));
      body.append(h('div', { class: 'stack' }, g.items.map((it) => card(it))));
    }
    if (msgs.length) {
      body.append(h('h3', { class: 'child-heading', text: 'School messages' }));
      body.append(h('div', { class: 'stack' }, msgs.map((it) => card(it))));
    }
    frag.append(section('New & changed', since, body));
  } else if (!a.needs.length) {
    frag.append(h('div', { class: 'empty section' }, h('h3', { text: 'All caught up' }), h('p', { text: `Nothing new ${since}.` })));
  }

  frag.append(section(`Coming up · next ${state.settings.dueSoonDays} days`, 'Includes unchanged items, for context',
    a.upcoming.length ? agenda(a.upcoming) : h('p', { class: 'muted', text: 'Nothing due.' })));

  if (a.pastDue.length) {
    const d = h('details', { class: 'section' },
      h('summary', null, `Past due, still marked Pending (${a.pastDue.length})`, h('span', { class: 'hint', text: 'Last 14 days. “Pending” may just mean not graded yet.' })),
      agenda(a.pastDue));
    frag.append(d);
  }
  return frag;
}

function stat(n, label) {
  return h('div', { class: 'stat' }, h('b', { text: String(n) }), h('span', { text: label }));
}

function section(title, hint, body) {
  return h('section', { class: 'section' }, h('h2', null, title, hint && h('span', { class: 'hint', text: `· ${hint}` })), body);
}

function agenda(items) {
  const multi = (state.view?.children.length || 0) > 1;
  return h('div', { class: 'agenda' }, items.map((it) => {
    const done = isDone(it.status);
    const pending = /^pending$/i.test(it.status || '');
    return h('div', { class: `agenda-row${done ? ' done' : ''}` },
      h('span', { class: 'when', text: formatDay(fromISODate(it.due)) }),
      h('span', { class: 'what' },
        h('a', { href: it.link, target: '_blank', rel: 'noopener' }, h('b', { text: it.title })),
        h('small', { text: [multi && it.childName, it.context, it.meta.find(([k]) => k === 'Type')?.[1]].filter(Boolean).join(' · ') })),
      h('span', { class: `st${pending ? ' pending' : ''}`, text: it.status || '' }));
  }));
}

// --- Rendering: child feed ---------------------------------------------------------------------

function childTab(child) {
  const f = (state.filters[child.id] ??= { kind: 'all', onlyNew: false, showOlder: false });
  const frag = document.createDocumentFragment();
  const c = child.counts;
  frag.append(h('p', { class: 'child-meta', text: `${child.name} · ${c.classes} classes · ${c.assignments} assignments · ${c.feedback} feedback entries · ${c.updates} updates` }));

  const kindsPresent = Object.keys(KINDS).filter((k) => child.items.some((i) => i.kind === k));
  const rerender = () => renderPanel();
  frag.append(h('div', { class: 'feed-tools' },
    ['all', ...kindsPresent].map((k) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(f.kind === k), text: k === 'all' ? 'All' : pluralKind(k),
      onclick: () => { f.kind = k; rerender(); },
    })),
    h('span', { class: 'spacer' }),
    h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: f.onlyNew, onchange: (e) => { f.onlyNew = e.target.checked; rerender(); } }), `Only new & changed (${child.newCount})`)));

  const cutoff = startOfDay(new Date()).getTime() - FEED_WINDOW_DAYS * DAY_MS;
  let items = child.items.filter((i) => (f.kind === 'all' || i.kind === f.kind) && (!f.onlyNew || !!i.state));
  const older = items.filter((i) => i.ts < cutoff && !i.state);
  if (!f.showOlder) items = items.filter((i) => !(i.ts < cutoff && !i.state));

  if (!items.length) {
    frag.append(h('div', { class: 'empty' }, h('h3', { text: 'Nothing here' }), h('p', { text: f.onlyNew ? 'No new or changed items for this filter.' : 'No items for this filter.' })));
  }

  let lastDay = null;
  let stack = null;
  for (const it of items) {
    const day = it.ts ? toISODate(new Date(it.ts)) : 'undated';
    if (day !== lastDay) {
      lastDay = day;
      frag.append(h('div', { class: 'day', text: day === 'undated' ? 'Undated' : formatDay(new Date(it.ts)) }));
      stack = h('div', { class: 'stack' });
      frag.append(stack);
    }
    stack.append(card(it));
  }

  if (!f.showOlder && older.length) {
    frag.append(h('p', { style: 'text-align:center;margin-top:20px' },
      h('button', { class: 'btn', type: 'button', text: `Show ${older.length} older items`, onclick: () => { f.showOlder = true; rerender(); } })));
  }
  return frag;
}

function pluralKind(k) {
  return { assignment: 'Assignments', feedback: 'Feedback', attendance: 'Attendance', post: 'Class posts', update: 'Other updates', message: 'School messages' }[k];
}

// --- Rendering: a single item ------------------------------------------------------------------

function whenText(it) {
  if (!it.ts) return it.dateLabel || '';
  const d = new Date(it.ts);
  return it.dateOnly ? formatDay(d) : `${formatDay(d)}, ${formatTime(d)}`;
}

function card(it, { showChild = false, reason = null } = {}) {
  const multi = (state.view?.children.length || 0) > 1;
  const el = h('article', { class: `card kind-${it.kind}${it.state ? ` state-${it.state}` : ''}` });

  el.append(h('div', { class: 'card-head' },
    showChild && multi && it.childName ? h('span', { class: 'who', text: it.childName }) : null,
    h('span', { class: 'kind', text: KINDS[it.kind] }),
    it.context ? h('span', { class: 'ctx', text: it.context }) : null,
    it.state ? h('span', { class: `badge ${it.state}`, text: it.state }) : null,
    it.stale ? h('span', { class: 'badge stale', text: 'not refreshed', title: 'This class failed to load; showing the last known data.' }) : null,
    reason ? h('span', { class: 'reason', text: reason }) : null,
    h('time', { text: whenText(it) })));

  el.append(h('h3', { text: it.title }));

  if (it.meta?.length) {
    el.append(h('dl', { class: 'meta' }, it.meta.map(([k, v]) => h('div', null, h('dt', { text: k }), h('dd', { text: v })))));
  }

  if (it.changes?.length) {
    el.append(h('div', { class: 'changes' }, it.changes.map((c) => {
      const long = c.field === 'notes' || String(c.before).length + String(c.after).length > 80;
      return h('div', { class: `change${long ? ' long' : ''}` },
        h('span', { text: c.label }),
        h('div', { class: 'ba' },
          h('del', { text: changeText(c.field, c.before) }),
          long ? null : '→',
          h('ins', { text: changeText(c.field, c.after) })));
    })));
  }

  if (it.deadlines?.length && it.kind !== 'message') {
    el.append(h('ul', { class: 'deadlines', 'aria-label': 'Possible deadlines' }, it.deadlines.map((l) => h('li', { text: l }))));
  }

  if (it.kind === 'message' && it.events) {
    el.append(h('div', { class: 'events' }, h('div', { class: 'body-label', text: 'Upcoming events' }), textBlock(`${it.id}:events`, it.events, false)));
  } else if (it.kind === 'message' && it.deadlines?.length) {
    el.append(h('ul', { class: 'deadlines', 'aria-label': 'Possible deadlines' }, it.deadlines.map((l) => h('li', { text: l }))));
  }

  if (it.body) {
    const collapsedByDefault = it.collapsed && it.kind === 'message';
    el.append(h('div', { class: 'body' },
      it.bodyLabel ? h('div', { class: 'body-label', text: it.bodyLabel }) : null,
      textBlock(it.id, it.body, !!it.verbatim, collapsedByDefault)));
  }

  const foot = h('div', { class: 'card-foot' });
  if (it.link) foot.append(h('a', { href: it.link, target: '_blank', rel: 'noopener' }, 'Open in Veracross', externalIcon()));
  if (it.postMissing) foot.append(h('span', { class: 'muted', text: 'Post text not loaded yet' }));
  if (it.body && it.body.length > 20 && translationAvailable() && probablyNotEnglish(it.body)) foot.append(translateButton(it, el));
  if (foot.childNodes.length) el.append(foot);
  return el;
}

function changeText(field, value) {
  if (value === '' || value == null) return '(empty)';
  if (field === 'due') {
    const d = fromISODate(value);
    if (d) return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return String(value);
}

function textBlock(id, text, verbatim, startCollapsed = false) {
  const wrap = h('div');
  const long = text.length > CLAMP_CHARS || text.split('\n').length > 10;
  const p = h('p', { class: `text${verbatim ? ' verbatim' : ''}`, text });
  wrap.append(p);
  if (long || startCollapsed) {
    const key = id;
    const apply = () => {
      const open = state.expanded.has(key);
      p.classList.toggle('clamped', !open);
      btn.textContent = open ? 'Show less' : 'Show all';
    };
    const btn = h('button', { class: 'linkish', type: 'button', onclick: () => { state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key); apply(); } });
    wrap.append(btn);
    apply();
  }
  return wrap;
}

function translateButton(it, cardEl) {
  const btn = h('button', { class: 'linkish', type: 'button', text: 'Translate to English' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Translating on this device…';
    try {
      const r = await toEnglish(it.body);
      if (!r.text) { btn.textContent = r.source === 'en' ? 'Already in English' : 'Language not recognized'; return; }
      cardEl.querySelector('.body').append(h('div', { class: 'translation' },
        h('div', { class: 'body-label', text: `English translation (from ${r.source}, on-device; the original above is authoritative)` }),
        h('p', { class: 'text', text: r.text })));
      btn.remove();
    } catch (e) {
      btn.textContent = `Translation unavailable: ${e.message}`;
    }
  });
  return btn;
}

// --- Diagnostics -------------------------------------------------------------------------------

async function renderDiagnostics() {
  const box = $('#diagnostics .diag-body');
  box.replaceChildren();
  const snap = state.latest;
  if (!snap) { box.append(h('p', { text: 'No data yet.' })); return; }
  box.append(h('p', { text: `Snapshot ${new Date(snap.takenAt).toLocaleString()} · ${snap.stats?.requests ?? '?'} requests · fetch mode: ${Object.entries(snap.stats?.modes || {}).map(([k, v]) => `${k.split('.')[0]}=${v}`).join(', ') || 'n/a'}` }));
  box.append(h('table', null,
    h('tr', null, ['Child', 'Classes', 'Assignments', 'Feedback', 'Updates', 'Problems'].map((t) => h('th', { text: t }))),
    snap.children.map((c) => h('tr', null,
      h('td', { text: c.name }),
      h('td', { text: `${c.enrollments.filter((e) => e.ok?.assignments).length}/${c.enrollments.length}` }),
      h('td', { text: Object.keys(c.assignments).length }),
      h('td', { text: Object.keys(c.feedback).length }),
      h('td', { text: Object.keys(c.updates).length }),
      h('td', { text: c.errors.length + c.warnings.length })))));
  const lines = [
    ...snap.errors.map((e) => `Error: ${e}`),
    ...snap.warnings,
    ...snap.children.flatMap((c) => [...c.errors.map((e) => `${c.name} error: ${e}`), ...c.warnings.map((w) => `${c.name}: ${w}`)]),
    ...snap.children.flatMap((c) => c.enrollments.filter((e) => e.nameSource === 'order').map((e) => `${c.name}: “${e.className}” matched by page order`)),
  ];
  if (lines.length) box.append(h('ul', null, lines.map((l) => h('li', { text: l }))));
  const bytes = await bytesInUse();
  if (bytes != null) box.append(h('p', { text: `Local storage used: ${(bytes / 1024).toFixed(0)} KB` }));
}

// --- Settings & history ------------------------------------------------------------------------

function openSettings() {
  const form = $('#settingsForm');
  const s = state.settings;
  form.school.value = s.school;
  form.dueSoonDays.value = String(s.dueSoonDays);
  form.firstRunLookbackDays.value = String(s.firstRunLookbackDays);
  form.schedule.value = s.schedule;
  form.notify.checked = s.notify;
  form.fetchPostText.checked = s.fetchPostText;
  const canSchedule = inExtension && !!ext.offscreen;
  form.schedule.disabled = !canSchedule;
  if (!canSchedule) $('#scheduleNote').textContent = 'Not available in this browser. Refresh by hand from this page.';
  $('#settingsDialog').showModal();
}

async function onSettingsChange(e) {
  const form = e.currentTarget;
  const patch = {
    school: form.school.value.trim().replace(/^\/+|\/+$/g, ''),
    dueSoonDays: Number(form.dueSoonDays.value),
    firstRunLookbackDays: Number(form.firstRunLookbackDays.value),
    schedule: form.schedule.value,
    notify: form.notify.checked,
    fetchPostText: form.fetchPostText.checked,
  };
  const schoolChanged = patch.school !== state.settings.school;
  state.settings = await saveSettings(patch);
  if (schoolChanged) await load();
  else computeView();
  render();
}

function openHistory() {
  const body = $('#historyBody');
  body.replaceChildren();
  if (!state.history.length) body.append(h('p', { class: 'muted', text: 'No past digests yet. Each “Mark all as seen” saves one here.' }));
  for (const d of state.history) {
    const items = [...d.children.flatMap((c) => c.items.map((i) => ({ ...i, childName: c.name }))), ...d.messages];
    body.append(h('details', { class: 'hist' },
      h('summary', { text: `${new Date(d.seenAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${d.total} item${d.total === 1 ? '' : 's'}` }),
      h('ul', null, items.map((i) => h('li', null,
        h('b', { text: `${i.state || ''} ${KINDS[i.kind]}`.trim() }), ' · ', i.title,
        h('small', { text: ` ${[i.childName, i.context].filter(Boolean).join(' · ')}` }),
        i.changes?.length ? h('small', { text: ` (${i.changes.map((c) => c.label).join(', ')} changed)` }) : null)))));
  }
  $('#historyDialog').showModal();
}

// --- Boot --------------------------------------------------------------------------------------

async function main() {
  if (DEMO) {
    const { seedDemo } = await import('./demo.js');
    await seedDemo();
  }
  state.tab = location.hash.slice(1) || 'actions';
  await load();
  render();
  setBadge();

  $('#refreshBtn').addEventListener('click', refresh);
  $('#seenBtn').addEventListener('click', markAllSeen);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#historyBtn').addEventListener('click', openHistory);
  $('#settingsForm').addEventListener('change', onSettingsChange);
  $('#clearData').addEventListener('click', async () => {
    if (!confirm('Delete all digest data stored in this browser? Your Veracross account is not affected.')) return;
    await clearAll();
    $('#settingsDialog').close();
    await load();
    render();
    setBadge();
  });

  // A scheduled check (or another dashboard tab) may update storage while this page is open.
  if (inExtension) {
    ext.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName !== 'local' || state.busy) return;
      const school = state.settings.school;
      if (changes[`latest:${school}`] || changes[`baseline:${school}`] || changes[`status:${school}`]) {
        await load();
        render();
      }
    });
  }
}

main();
