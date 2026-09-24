// Builds a snapshot of everything the digest needs, from the parent's own logged-in session.
// `previous` (the last stored snapshot) lets us skip re-reading message bodies and class posts
// we already have, and keep data for any source that fails this time.

import { urls, HOSTS } from './config.js';
import { parseHTML, parseChildren, parseStudentName, plausibleChildName, parseEnrollments, parseRecentUpdates, parseMessageList, parseMessageDetail } from './parse.js';
import { normalizeAssignment, normalizeFeedback } from './normalize.js';
import { SessionExpiredError } from './fetcher.js';
import { textOf, extractSection } from './text.js';
import { fromISODate, DAY_MS } from './dates.js';

export const SNAPSHOT_VERSION = 1;
const POST_RE = /\/website\/posts\/\d+/;
// Bump when parseMessageDetail changes so cached message bodies are read again.
const MESSAGE_DETAIL_VERSION = 2;

export async function collectSnapshot({ school, fetcher, previous = null, settings, onProgress = () => {}, now = new Date() }) {
  const snap = {
    version: SNAPSHOT_VERSION,
    school,
    takenAt: now.getTime(),
    children: [],
    messages: {},
    warnings: [],
    errors: [],
    stats: {},
  };
  const prevChild = (id) => previous?.children?.find((c) => c.id === id) || null;
  const step = (label, done, total) => onProgress({ label, done, total });

  // Any SessionExpiredError aborts the whole run: partial data would look like mass removals.
  const soft = async (what, fn, sink) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof SessionExpiredError) throw e;
      sink.push(`${what}: ${e.message}`);
      return null;
    }
  };

  step('Finding your children', 0, 1);
  const home = await fetcher.getHTML(urls.parentHome(school));
  const { children, warnings: childWarnings } = parseChildren(parseHTML(home.html), school);
  snap.warnings.push(...childWarnings);
  if (!children.length) {
    throw new Error('No children found on the parent portal home page. The portal layout may have changed, or this account has no students.');
  }

  // Rough total for the progress bar; refined once enrollments are known.
  let total = 2 + children.length * 2;
  let done = 1;

  for (const c of children) {
    const prev = prevChild(c.id);
    const child = { id: c.id, name: c.name, enrollments: [], assignments: {}, feedback: {}, updates: {}, warnings: [], errors: [] };
    snap.children.push(child);

    step(`${c.name}: classes`, done, total);
    const overviewUrl = urls.overview(school, c.id);
    const ov = await soft('Overview page', () => fetcher.getHTML(overviewUrl), child.errors);
    done++;
    if (ov) {
      const ovDoc = parseHTML(ov.html);
      if (!c.nameFound) {
        const n = parseStudentName(ovDoc);
        if (n && !snap.children.some((o) => o !== child && o.name === n)) child.name = c.name = n;
        else if (plausibleChildName(prev?.name)) child.name = c.name = prev.name;
      }
      const { enrollments, warnings } = parseEnrollments(ovDoc, ov.url);
      child.enrollments = enrollments.map((e) => ({ ...e, ok: { assignments: false, feedback: false } }));
      child.warnings.push(...warnings);
      if (!enrollments.length) child.warnings.push('No classes found on the overview page.');
    } else if (prev) {
      child.enrollments = prev.enrollments.map((e) => ({ ...e, ok: { assignments: false, feedback: false } }));
      child.warnings.push('Using the class list from the previous refresh.');
    }
    total += child.enrollments.length * 2;

    for (const enr of child.enrollments) {
      step(`${c.name}: ${enr.className}`, done, total);
      const aj = await soft(`${enr.className} assignments`, () => fetcher.getJSON(urls.assignmentsJson(school, enr.id)), child.errors);
      done++;
      const titles = new Map();
      if (aj && Array.isArray(aj.assignments)) {
        enr.ok.assignments = true;
        for (const raw of aj.assignments) {
          const a = normalizeAssignment(raw, enr);
          child.assignments[a.key] = a;
          titles.set(a.id, a.title);
        }
      } else if (prev) {
        // Keep last known data so the feed doesn't empty out and the diff doesn't report removals.
        for (const a of Object.values(prev.assignments)) {
          if (a.enrollmentId === enr.id) { child.assignments[a.key] = { ...a, stale: true }; titles.set(a.id, a.title); }
        }
      }

      step(`${c.name}: ${enr.className} feedback`, done, total);
      const fj = await soft(`${enr.className} feedback`, () => fetcher.getJSON(urls.feedbackJson(school, enr.id)), child.errors);
      done++;
      if (fj && Array.isArray(fj.feedback)) {
        enr.ok.feedback = true;
        for (const raw of fj.feedback) {
          const f = normalizeFeedback(raw, enr, titles, now);
          if (f.id) child.feedback[f.id] = f;
        }
      } else if (prev) {
        for (const f of Object.values(prev.feedback)) if (f.enrollmentId === enr.id) child.feedback[f.id] = { ...f, stale: true };
      }
    }

    step(`${c.name}: recent updates`, done, total);
    const ru = await soft('Recent updates', () => fetcher.getHTML(urls.recentUpdates(school, c.id)), child.errors);
    done++;
    // Recent updates only covers a short window, so accumulate what we've seen before.
    const cutoff = now.getTime() - settings.retainDays * DAY_MS;
    for (const u of Object.values(prev?.updates || {})) {
      const d = fromISODate(u.date);
      if (!d || d.getTime() >= cutoff) child.updates[u.key] = u;
    }
    if (ru) {
      const { entries, warnings } = parseRecentUpdates(parseHTML(ru.html), ru.url, now);
      child.warnings.push(...warnings);
      for (const e of entries) {
        const old = child.updates[e.key];
        child.updates[e.key] = { ...e, firstSeen: old?.firstSeen ?? now.getTime(), post: old?.post ?? null };
      }
    }
  }

  // Class posts render client-side; read the newest unread ones in a background tab.
  if (settings.fetchPostText && fetcher.allowTabs) {
    const pending = [];
    for (const child of snap.children) {
      for (const u of Object.values(child.updates)) {
        if (u.href && POST_RE.test(u.href) && !u.post?.text && new URL(u.href).host === HOSTS.classes) pending.push(u);
      }
    }
    pending.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const batch = pending.slice(0, settings.maxPostFetchesPerRefresh);
    // The same post can appear under two children; read each URL once.
    const byUrl = new Map();
    total += batch.length;
    for (const u of batch) {
      if (!byUrl.has(u.href)) {
        step('Reading class posts', done, total);
        byUrl.set(u.href, await soft('Class post', () => fetcher.renderedText(u.href), snap.warnings));
      }
      done++;
      const r = byUrl.get(u.href);
      if (r?.text) u.post = { text: cleanPostText(r.text), title: r.title, fetchedAt: now.getTime() };
    }
    if (pending.length > batch.length) snap.warnings.push(`${pending.length - batch.length} more class posts will be read on the next refresh.`);
  }

  // School messages (household-wide).
  step('School messages', done, total);
  const ml = await soft('Messages list', () => fetcher.getHTML(urls.messages(school)), snap.errors);
  const prevMessages = previous?.messages || {};
  const cutoff = now.getTime() - settings.retainDays * DAY_MS;
  for (const m of Object.values(prevMessages)) {
    const d = fromISODate(m.date);
    if (!d || d.getTime() >= cutoff) snap.messages[m.id] = m;
  }
  if (ml) {
    const { messages, warnings } = parseMessageList(parseHTML(ml.html), school, ml.url, now);
    snap.warnings.push(...warnings);
    for (const m of messages) {
      const old = snap.messages[m.id];
      snap.messages[m.id] = { ...m, firstSeen: old?.firstSeen ?? now.getTime(), detail: old?.detail ?? null };
    }
    const toFetch = Object.values(snap.messages)
      .filter((m) => m.detail?.v !== MESSAGE_DETAIL_VERSION)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id))
      .slice(0, settings.maxMessageFetchesPerRefresh);
    total += toFetch.length;
    for (const m of toFetch) {
      step(`Message: ${m.title.slice(0, 40)}`, done, total);
      const detail = await soft(`Message ${m.id}`, () => fetchMessageDetail(fetcher, school, m.id, now), snap.warnings);
      done++;
      if (detail) {
        m.detail = detail;
        if (!m.date && detail.sent) m.date = detail.sent;
      }
    }
  }

  step('Done', total, total);
  snap.stats = { requests: fetcher.count, modes: fetcher.describe() };
  return snap;
}

async function fetchMessageDetail(fetcher, school, id, now) {
  const page = await fetcher.getHTML(urls.messageDetail(school, id));
  const d = parseMessageDetail(parseHTML(page.html), now);
  let text = d.text;
  // Some email bodies live in an iframe.
  if (text.length < 200 && d.frames.length) {
    for (const f of d.frames) {
      if (f.srcdoc) { text = textOf(parseHTML(f.srcdoc).body); break; }
      if (f.src) {
        const src = new URL(f.src, page.url);
        if (!Object.values(HOSTS).includes(src.host)) continue;
        const inner = await fetcher.getHTML(src.href);
        text = textOf(parseHTML(inner.html).body);
        break;
      }
    }
  }
  return {
    subject: d.subject,
    sender: d.sender,
    sent: d.sent,
    sentLabel: d.sentLabel,
    text,
    events: extractSection(text),
    fetchedAt: now.getTime(),
    v: MESSAGE_DETAIL_VERSION,
  };
}

// Class website pages include site navigation around the post. Trim obvious chrome lines.
function cleanPostText(t) {
  const lines = String(t).split('\n').map((l) => l.trim());
  return lines.filter((l, i) => l || (i > 0 && lines[i - 1])).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
