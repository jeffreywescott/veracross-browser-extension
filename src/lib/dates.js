// Date helpers. Veracross mixes formats: "09/22/2026", "Monday, September 22, 2026",
// "Sep 20 @ 9:28 P" (no year), and section headings like "Today" / "Tuesday, September 22".
// Everything is interpreted in the browser's local time zone.

const DAY_MS = 86400000;

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  // German month names show up in some German-language schools.
  januar: 0, jän: 0, februar: 1, märz: 2, maerz: 2, mai: 4, juni: 5, juli: 6, okt: 9, oktober: 9, dez: 11, dezember: 11,
};

function monthIndex(word) {
  if (!word) return null;
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w in MONTHS) return MONTHS[w];
  const three = w.slice(0, 3);
  if (w.length >= 3 && three in MONTHS && 'january february march april may june july august september october november december'.includes(w)) return MONTHS[three];
  return null;
}

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function valid(y, m, d) {
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const x = new Date(y, m, d);
  return x.getMonth() === m ? x : null;
}

// For dates shown without a year: pick the year that puts the date closest to `now`,
// leaning toward the past (feedback, updates and messages are things that already happened).
export function inferYear(month, day, now = new Date(), futureToleranceDays = 45) {
  const y = now.getFullYear();
  const candidate = valid(y, month, day);
  if (!candidate) return null;
  if (candidate.getTime() - now.getTime() > futureToleranceDays * DAY_MS) return valid(y - 1, month, day);
  if (now.getTime() - candidate.getTime() > (365 - futureToleranceDays) * DAY_MS) return valid(y + 1, month, day);
  return candidate;
}

// "09/22/2026" -> Date (local midnight)
export function parseMDY(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? valid(+m[3], +m[1] - 1, +m[2]) : null;
}

// "Sep 20 @ 9:28 P" / "Sep 20 @ 9:28 PM" / "Sep 20, 2026 @ 9:28 AM"
export function parseFeedbackDate(s, now = new Date()) {
  const str = String(s ?? '').trim();
  const m = str.match(/^([A-Za-zäÄ]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\s*(?:@|at)?\s*(\d{1,2}):(\d{2})\s*([AaPp])?\.?[Mm]?\.?/);
  if (!m) return parseLooseDate(str, now);
  const mon = monthIndex(m[1]);
  if (mon == null) return null;
  const base = m[3] ? valid(+m[3], mon, +m[2]) : inferYear(mon, +m[2], now);
  if (!base) return null;
  let h = +m[4] % 12;
  if (m[6] && m[6].toLowerCase() === 'p') h += 12;
  if (!m[6] && +m[4] === 12) h = 12;
  base.setHours(h, +m[5], 0, 0);
  return base;
}

// Best-effort parse of any date-ish string. Returns null when unsure.
export function parseLooseDate(s, now = new Date()) {
  const str = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!str || str.length > 60) return null;
  const lower = str.toLowerCase();
  if (/^(today|heute)\b/.test(lower)) return startOfDay(now);
  if (/^(yesterday|gestern)\b/.test(lower)) return startOfDay(addDays(now, -1));

  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(+m[1], +m[2] - 1, +m[3]);

  m = str.match(/(?:^|\D)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\D|$)/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
    return y ? valid(y, +m[1] - 1, +m[2]) : inferYear(+m[1] - 1, +m[2], now);
  }

  // "Monday, September 22, 2026" / "Sep 22" / "September 22nd 2026"
  m = str.match(/([A-Za-zäÄ]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b,?(?:\s+(\d{4}))?/);
  if (m && monthIndex(m[1]) != null) {
    const mon = monthIndex(m[1]);
    return m[3] ? valid(+m[3], mon, +m[2]) : inferYear(mon, +m[2], now);
  }

  // "22 September 2026" / "22. September"
  m = str.match(/\b(\d{1,2})\.?\s+([A-Za-zäÄ]{3,})\.?(?:\s+(\d{4}))?/);
  if (m && monthIndex(m[2]) != null) {
    const mon = monthIndex(m[2]);
    return m[3] ? valid(+m[3], mon, +m[1]) : inferYear(mon, +m[1], now);
  }
  return null;
}

export function toISODate(d) {
  if (!d) return null;
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  const mm = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${mm}-${dd}`;
}

export function fromISODate(s) {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

export function formatDay(d, now = new Date()) {
  if (!d) return '';
  const diff = daysBetween(now, d);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  const sameYear = new Date(d).getFullYear() === now.getFullYear();
  return new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function formatTime(d) {
  return new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatRelative(ts, now = Date.now()) {
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export { DAY_MS };
