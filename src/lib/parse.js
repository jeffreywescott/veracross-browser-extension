// HTML parsers for the parent portal pages. The portal markup is undocumented and can change,
// so every parser keys off URL patterns in links first and uses DOM structure only as a hint.
// Each parser returns plain data plus `warnings` describing anything it had to guess.

import { textOf, oneLine, normalizeText, hash } from './text.js';
import { parseLooseDate, toISODate } from './dates.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseHTML(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function resolve(href, baseUrl) {
  try { return new URL(href, baseUrl).href; } catch { return null; }
}

function links(doc) {
  return [...doc.querySelectorAll('a[href]')];
}

const GENERIC = new Set([
  'overview', 'my children', 'children', 'my child', 'student', 'students', 'grades', 'assignments', 'schedule',
  'attendance', 'view', 'details', 'profile', 'recent updates', 'reports', 'calendar', 'daily schedule', 'more',
  'home', 'menu', 'classes', 'class', 'website', 'class website', 'messages', 'directory', 'account',
]);

// Portal section/navigation words. A child's name never contains these as whole words,
// but headings near the child links ("Classes & Grades", "Recent Updates (3)") do.
const NAV_WORDS = /\b(classes|class|grades|gradebook|assignments?|overview|schedule|attendance|calendar|reports?|report cards?|updates|messages|portal|home|children|students?|profile|directory|account|menu|website|homework|household|resources|documents|forms|settings|log ?out|sign ?out|details|view)\b/i;

function plausibleName(s) {
  const t = oneLine(s);
  if (t.length < 2 || t.length > 60) return null;
  if (!/\p{L}/u.test(t)) return null;
  if (GENERIC.has(t.toLowerCase())) return null;
  return t;
}

export function plausibleChildName(s) {
  const t = plausibleName(s);
  if (!t || NAV_WORDS.test(t) || /\d{3,}/.test(t) || t.split(' ').length > 6) return null;
  return t;
}

function isHeadingLike(el) {
  const tag = el.tagName.toUpperCase();
  if (/^H[1-6]$/.test(tag)) return true;
  if (el.getAttribute('role') === 'heading') return true;
  const cls = el.getAttribute('class') || '';
  return /(^|[\s_-])(name|title|heading|header|label)([\s_-]|$)/i.test(cls) && el.querySelectorAll('a, li, p, div').length === 0;
}

// --- 1. Children, from the parent home page -------------------------------------------------

export function parseChildren(doc, school) {
  const re = new RegExp(`/${esc(school)}/parent/student/(\\d+)/overview`);
  const all = [...doc.querySelectorAll('*')];
  const pos = new Map(all.map((e, i) => [e, i]));
  const candidates = new Map(); // id -> ordered candidate names, best first
  const warnings = [];

  for (const a of links(doc)) {
    const m = (a.getAttribute('href') || '').match(re);
    if (!m) continue;
    const id = m[1];
    const list = candidates.get(id) || [];
    candidates.set(id, list);
    list.push(textOf(a), a.getAttribute('aria-label'), a.getAttribute('title'), a.querySelector('img[alt]')?.getAttribute('alt'));
    // Preceding headings in document order (the nav lists each child under a heading, possibly
    // with section headings such as "Classes" in between).
    // Stop at another child's link: headings before it belong to that child.
    let headings = 0;
    for (let i = pos.get(a) - 1, steps = 0; i >= 0 && steps < 200 && headings < 6; i--, steps++) {
      const el = all[i];
      const other = el.tagName.toUpperCase() === 'A' ? (el.getAttribute('href') || '').match(re) : null;
      if (other && other[1] !== id) break;
      if (el.contains(a) || !isHeadingLike(el)) continue;
      headings++;
      list.push(textOf(el));
    }
  }

  // A candidate that shows up for more than one child is a section heading, not a name.
  const clean = new Map([...candidates].map(([id, list]) => [id, [...new Set(list.map(plausibleChildName).filter(Boolean))]]));
  const owners = new Map();
  for (const [id, list] of clean) for (const n of list) owners.set(n, (owners.get(n) || new Set()).add(id));

  const children = [...clean].map(([id, list]) => {
    const name = list.find((n) => clean.size === 1 || owners.get(n).size === 1) || null;
    if (!name) warnings.push(`Could not find a name for student ${id} on the home page.`);
    return { id, name: name || `Student ${id}`, nameFound: !!name };
  });
  return { children, warnings };
}

// Name from the student's own overview page (heading or document title), used when the home
// page gave nothing usable.
export function parseStudentName(doc) {
  const texts = [...doc.querySelectorAll('h1, h2, [class*="student-name" i], [class*="studentName"]')].map((el) => textOf(el));
  texts.push(...String(doc.title || '').split(/\s[|–—-]\s/));
  for (const t of texts) {
    const n = plausibleChildName(t);
    if (n) return n;
  }
  return null;
}

// --- 2. Enrollments (classes), from the student overview page -------------------------------

const ENROLL_RE = /\/classes\/(\d+)\/assignments/;
const COURSE_RE = /classes\.veracross\.com\/[^/]+\/course\/(\d+)\/website/;

export function parseEnrollments(doc, baseUrl) {
  const warnings = [];
  const all = links(doc);
  const enrollLinks = all.filter((a) => ENROLL_RE.test(a.getAttribute('href') || ''));
  const courseLinks = all.filter((a) => COURSE_RE.test(a.getAttribute('href') || ''));

  const enrollIdsIn = (el) => new Set(enrollLinks.filter((a) => el.contains(a)).map((a) => a.getAttribute('href').match(ENROLL_RE)[1]));

  const byId = new Map();
  for (const a of enrollLinks) {
    const href = a.getAttribute('href');
    const id = href.match(ENROLL_RE)[1];
    if (byId.has(id)) continue;
    const entry = { id, className: null, courseId: null, href: resolve(href, baseUrl), nameSource: null };

    // DOM proximity: the smallest ancestor that holds this enrollment (and no other) plus a course link.
    for (let anc = a.parentElement; anc && anc.tagName.toUpperCase() !== 'BODY'; anc = anc.parentElement) {
      if (enrollIdsIn(anc).size > 1) break;
      const course = courseLinks.find((c) => anc.contains(c));
      if (course) {
        entry.className = plausibleName(textOf(course)) || null;
        entry.courseId = course.getAttribute('href').match(COURSE_RE)[1];
        entry.nameSource = 'proximity';
        if (!entry.className) {
          // Course link may be an icon; use the container's heading instead.
          const h = [...anc.querySelectorAll('*')].find(isHeadingLike);
          entry.className = h ? plausibleName(textOf(h)) : null;
        }
        break;
      }
    }
    byId.set(id, entry);
  }

  const enrollments = [...byId.values()];

  // Fallback: match by order when counts line up (fragile, so flagged).
  const uniqueCourses = [];
  const seenCourse = new Set();
  for (const c of courseLinks) {
    const cid = c.getAttribute('href').match(COURSE_RE)[1];
    if (!seenCourse.has(cid)) { seenCourse.add(cid); uniqueCourses.push(c); }
  }
  if (enrollments.some((e) => !e.className) && uniqueCourses.length === enrollments.length) {
    enrollments.forEach((e, i) => {
      if (e.className) return;
      e.className = plausibleName(textOf(uniqueCourses[i]));
      e.courseId = uniqueCourses[i].getAttribute('href').match(COURSE_RE)[1];
      e.nameSource = 'order';
    });
    warnings.push('Some class names were matched to enrollments by page order; they may be mislabeled.');
  }

  // Last resort: text around the enrollment link itself.
  for (const e of enrollments) {
    if (e.className) continue;
    const a = enrollLinks.find((x) => x.getAttribute('href').match(ENROLL_RE)[1] === e.id);
    let name = plausibleName(textOf(a));
    for (let anc = a.parentElement; !name && anc && enrollIdsIn(anc).size === 1; anc = anc.parentElement) {
      const firstLine = textOf(anc).split('\n').map(plausibleName).find(Boolean);
      name = firstLine || null;
    }
    e.className = name || `Class ${e.id}`;
    e.nameSource = name ? 'nearby-text' : 'none';
    if (!name) warnings.push(`No class name found for enrollment ${e.id}.`);
  }

  return { enrollments, warnings };
}

// --- 5. Recent updates per child --------------------------------------------------------------

const KNOWN_TYPES = [
  'daily attendance', 'class attendance', 'attendance', 'new post', 'updated post', 'new assignment',
  'updated assignment', 'assignment', 'grade', 'new grade', 'grade posted', 'report card', 'new message',
  'message', 'news', 'event', 'homework', 'announcement', 'new announcement', 'comment', 'new comment',
];

function ownTextLeaf(el) {
  // An element whose text is all its own (no block children). Labels and date headings look like this.
  if (el.querySelector('div, p, li, ul, ol, table, section, article')) return null;
  const t = oneLine(el.textContent);
  return t || null;
}

function typeLabel(el) {
  if (el.tagName.toUpperCase() === 'A' || el.closest('nav, header, footer, button, select, [role="navigation"], [role="menu"]')) return null;
  const t = ownTextLeaf(el);
  if (!t || t.length > 40) return null;
  if (KNOWN_TYPES.includes(t.toLowerCase())) return t.toUpperCase();
  // Unknown but plausible labels: short ALL-CAPS phrases naming a kind of update.
  if (/^[A-Z][A-Z0-9&/-]*(?: [A-Z0-9&/-]+){0,3}$/.test(t) && /\b(POST|ATTENDANCE|ASSIGNMENT|GRADE|MESSAGE|NEWS|EVENT|COMMENT|UPDATE|REPORT|HOMEWORK|ANNOUNCEMENT)S?\b/.test(t)) return t;
  return null;
}

function dateHeading(el, now) {
  const tag = el.tagName.toUpperCase();
  if (['A', 'BUTTON', 'OPTION', 'SCRIPT', 'STYLE'].includes(tag)) return null;
  const t = ownTextLeaf(el);
  if (!t || t.length > 40) return null;
  // Must be mostly a date, not a sentence containing one.
  if (t.split(' ').length > 5) return null;
  if (!/\d|today|yesterday|heute|gestern/i.test(t)) return null;
  const dt = el.getAttribute('datetime');
  return (dt && parseLooseDate(dt, now)) || parseLooseDate(t, now);
}

export function parseRecentUpdates(doc, baseUrl, now = new Date()) {
  const warnings = [];
  const body = doc.body || doc.documentElement;
  const all = [...body.querySelectorAll('*')];
  const labels = all.filter((el) => typeLabel(el) && !all.some((p) => p !== el && el.contains(p) && typeLabel(p)));
  const labelSet = new Set(labels);
  const dateEls = new Set(all.filter((el) => !labelSet.has(el) && dateHeading(el, now)));
  const countLabels = (el) => labels.filter((l) => el.contains(l)).length;

  const entries = [];
  let currentDate = null;
  for (const el of all) {
    if (dateEls.has(el) && !labels.some((l) => l.contains(el) || el.contains(l))) {
      currentDate = dateHeading(el, now);
      continue;
    }
    if (!labelSet.has(el)) continue;

    let container = el;
    while (container.parentElement && container.parentElement !== body) {
      const p = container.parentElement;
      if (countLabels(p) > 1) break;
      const strayDate = [...dateEls].some((d) => p.contains(d) && !container.contains(d));
      if (strayDate) break;
      container = p;
    }

    const type = typeLabel(el);
    let text = textOf(container);
    const labelText = oneLine(el.textContent);
    const idx = text.indexOf(labelText);
    if (idx >= 0) text = (text.slice(0, idx) + text.slice(idx + labelText.length));
    text = normalizeText(text);

    let date = currentDate;
    const innerDate = [...dateEls].find((d) => container.contains(d));
    if (innerDate) date = dateHeading(innerDate, now);

    const a = container.tagName.toUpperCase() === 'A' ? container : container.querySelector('a[href]');
    const href = a ? resolve(a.getAttribute('href'), baseUrl) : null;
    const iso = toISODate(date);
    // Key from the generic text so it stays stable if the structured fields below change.
    const key = hash(`${iso}|${type}|${oneLine(text)}`);
    entries.push({ key, date: iso, type, text, href, ...updateFields(container) });
  }

  if (!entries.length && textOf(body).length > 200) {
    warnings.push('Recent updates page loaded but no entries were recognized.');
  }
  if (entries.some((e) => !e.date)) warnings.push('Some recent updates had no recognizable date.');

  // The same entry can appear twice if the page repeats it (e.g. mobile + desktop layouts).
  const uniq = new Map(entries.map((e) => [e.key, e]));
  return { entries: [...uniq.values()], warnings };
}

// Veracross (EBGIS, Sep 2026) marks up each update as
//   a.update-link > .record-type ("New Post") + .item-class ("G5PE26: <span>Grade 5 PE</span>
//   <small class="item-teacher">Rivera</small>") + .item-type ("Absence") + .item-description.
// Return whichever of those fields exist; the feed falls back to line-splitting `text` otherwise.
function updateFields(container) {
  const root = container.closest?.('.update-link') || container;
  const field = (sel) => oneLine(textOf(root.querySelector(sel))) || null;
  const out = {};
  const cls = root.querySelector('.item-class');
  if (cls) {
    const teacher = cls.querySelector('.item-teacher');
    out.teacher = teacher ? oneLine(textOf(teacher)) || null : null;
    const name = cls.querySelector('span');
    const copy = cls.cloneNode(true);
    copy.querySelector('.item-teacher')?.remove();
    out.className = oneLine(textOf(name)) || oneLine(textOf(copy)).replace(/^[A-Z0-9.]+:\s*/, '') || null;
  }
  const detail = field('.item-type');
  const description = field('.item-description');
  if (detail) out.detail = detail;
  if (description) out.description = description;
  return out;
}

// --- 6. School messages -----------------------------------------------------------------------

export function parseMessageList(doc, school, baseUrl, now = new Date()) {
  const warnings = [];
  const re = new RegExp(`/${esc(school)}/parent/detail/email/(\\d+)`);
  const msgLinks = links(doc).filter((a) => re.test(a.getAttribute('href') || ''));
  const idOf = (a) => a.getAttribute('href').match(re)[1];
  const byId = new Map();

  for (const a of msgLinks) {
    const id = idOf(a);
    if (byId.has(id)) continue;
    let container = a;
    while (container.parentElement && container.parentElement.tagName.toUpperCase() !== 'BODY') {
      const p = container.parentElement;
      const ids = new Set(msgLinks.filter((x) => p.contains(x)).map(idOf));
      if (ids.size > 1) break;
      container = p;
    }
    const lines = textOf(container).split("\n").map((l) => l.trim()).filter(Boolean);
    const field = (sel) => oneLine(textOf(container.querySelector(sel))) || null;
    // Veracross list rows have .message-subject / .message-from / .message-category / .message-date-sent.
    const linkText = oneLine(textOf(a));
    const title = field('.message-subject') || (linkText.length > 3 ? linkText : lines.find((l) => l.length > 3 && !parseLooseDate(l, now))) || `Message ${id}`;
    let date = null;
    const timeEl = container.querySelector('time[datetime]');
    if (timeEl) date = parseLooseDate(timeEl.getAttribute('datetime'), now);
    if (!date && field('.message-date-sent')) date = parseLooseDate(field('.message-date-sent'), now);
    for (const l of lines) {
      if (date) break;
      if (l.length <= 40) date = parseLooseDate(l, now);
    }
    byId.set(id, {
      id, title, date: toISODate(date), href: resolve(a.getAttribute('href'), baseUrl),
      from: field('.message-from'), category: field('.message-category'),
      preview: lines.filter((l) => l !== title).slice(0, 3).join(' · '),
    });
  }

  if (!byId.size) warnings.push('No messages found on the messages page.');
  return { messages: [...byId.values()], warnings };
}

export function parseMessageDetail(doc, now = new Date()) {
  const clone = doc.body ? doc.body.cloneNode(true) : doc.documentElement.cloneNode(true);
  for (const el of clone.querySelectorAll('script, style, noscript, nav, [role="navigation"], [role="banner"], header.site-header, footer')) el.remove();

  const main = clone.querySelector('[class*="email-body" i], [class*="message-body" i], [class*="email-content" i], [class*="message-content" i], article, main, [role="main"]') || clone;
  const text = textOf(main);

  // Header outside the body. Veracross: small.vx-subtitle "From:" / "Date Sent:" with the value in a
  // span, and the subject in .vx-record-title. Search only the header so newsletter lines like
  // "FROM THE PRINCIPAL'S DESK" in the body can't be mistaken for the sender.
  const header = clone.cloneNode(true);
  header.querySelector('[class*="email-body" i], [class*="message-body" i], [class*="email-content" i], [class*="message-content" i]')?.remove();
  const labelled = (re) => {
    for (const lab of header.querySelectorAll('small, label, dt, th, .vx-subtitle')) {
      if (!re.test(oneLine(lab.textContent))) continue;
      const val = lab.querySelector('span') || lab.nextElementSibling;
      const t = oneLine(textOf(val)) || oneLine(lab.textContent).replace(re, '').trim();
      if (t) return t.slice(0, 120);
    }
    return null;
  };
  const full = textOf(header);
  const pick = (re) => { const m = full.match(re); return m ? oneLine(m[1]).slice(0, 120) : null; };
  const sender = labelled(/^from:?/i) || pick(/(?:^|\n)\s*From:\s*\n?\s*([^\n]+)/i);
  const sentRaw = labelled(/^(date sent|sent(?: on)?|date):?/i) || pick(/(?:^|\n)\s*(?:Date Sent|Sent(?: on)?|Date):\s*\n?\s*([^\n]+)/i);
  const subject = oneLine(textOf(clone.querySelector('.vx-record-title, [class*="subject" i], h1, h2'))) || null;

  const frames = [...clone.querySelectorAll('iframe')].map((f) => ({ src: f.getAttribute('src'), srcdoc: f.getAttribute('srcdoc') }));
  return {
    subject,
    sender,
    sent: sentRaw ? toISODate(parseLooseDate(sentRaw.replace(/\s+(at|@)\s+.*$/i, ''), now)) : null,
    sentLabel: sentRaw,
    text,
    frames,
  };
}

// Detects a login / SSO page served in place of the page we asked for.
export function looksLikeLoginPage(html) {
  const s = String(html).slice(0, 200000);
  return /<input[^>]+type=["']?password/i.test(s) || /\b(sign in|log in) to (your )?veracross\b/i.test(s);
}
