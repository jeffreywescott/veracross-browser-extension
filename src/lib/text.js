// Text extraction and small text heuristics. Works on any DOM implementation
// (browser DOMParser documents, linkedom in tests) — no layout-dependent APIs.

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'UL',
]);
const CELL = new Set(['TD', 'TH']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'HEAD']);

// Like innerText for a detached document: block elements become line breaks.
export function textOf(node) {
  if (!node) return '';
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) { out.push(n.data); return; }
    if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) return;
    const tag = n.tagName ? n.tagName.toUpperCase() : '';
    if (SKIP.has(tag)) return;
    if (tag === 'BR') { out.push('\n'); return; }
    const block = BLOCK.has(tag);
    if (block) out.push('\n');
    for (const c of n.childNodes) walk(c);
    if (block) out.push('\n');
    else if (CELL.has(tag)) out.push('\n');
  };
  walk(node);
  return normalizeText(out.join(''));
}

export function normalizeText(s) {
  return String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function oneLine(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

// Teacher notes / feedback sometimes arrive as HTML. Convert to plain text without
// changing the words. Plain strings pass through untouched (apart from line-ending cleanup).
export function htmlToText(s) {
  const str = String(s ?? '');
  if (!/<\/?[a-z][^>]*>|&[a-z]+;|&#\d+;/i.test(str)) return normalizeText(str);
  if (typeof DOMParser === 'undefined') return normalizeText(str.replace(/<[^>]+>/g, ' '));
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${str}</body></html>`, 'text/html');
  return textOf(doc.body);
}

// FNV-1a, 32-bit. Used for stable keys of items that have no id of their own.
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const WEEKDAY = '(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?';
const DEADLINE_RE = new RegExp(
  [
    '\\bdue\\b', '\\bdeadline', '\\bno later than\\b', '\\brsvp\\b', '\\bwaiver', '\\bpermission (?:slip|form)',
    '\\bsign(?:ed)?(?: and return| up|-up)\\b', '\\bregist(?:er|ration)\\b', '\\bplease (?:bring|return|submit|complete|send|fill)',
    '\\bmust (?:bring|return|submit|be)\\b', '\\breminder\\b', '\\bdon\'t forget\\b', '\\bform\\b.*\\bby\\b',
    `\\bby (?:${WEEKDAY}|tomorrow|tonight|the end of|end of|noon|\\d{1,2}[./]\\d{1,2}|\\d{1,2}(?:st|nd|rd|th)?\\b|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)`,
    // German
    '\\bbis (?:zum|spätestens|montag|dienstag|mittwoch|donnerstag|freitag)', '\\banmeld', '\\bmitbringen\\b', '\\babgabe', '\\bfrist\\b',
  ].join('|'),
  'i',
);

// Lines of free text that look like they ask the parent to do something by some time.
export function findDeadlineLines(text, max = 5) {
  const lines = String(text ?? '')
    .split(/\n|(?<=[.!?])\s+(?=[A-ZÄÖÜ])/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 8 && l.length <= 400);
  const hits = [];
  const seen = new Set();
  for (const l of lines) {
    if (DEADLINE_RE.test(l) && !seen.has(l)) {
      seen.add(l);
      hits.push(l);
      if (hits.length >= max) break;
    }
  }
  return hits;
}

// Newsletters often have an "Upcoming Events Overview" section. Return its text, if any.
export function extractSection(text, headingRe = /upcoming events(?: overview)?/i, maxChars = 2500) {
  const str = String(text ?? '');
  const m = str.match(headingRe);
  if (!m) return null;
  const after = str.slice(m.index + m[0].length).replace(/^[:\s]+/, '');
  // Stop at the next thing that looks like a section heading: a short line followed by a blank line,
  // written in title case or all caps, after we already have some content.
  const lines = after.split('\n');
  const out = [];
  let len = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (out.length > 3 && l.length > 0 && l.length < 60 && lines[i - 1] === '' && /^[A-Z0-9][A-Z0-9 &'’:-]+$/.test(l)) break;
    out.push(l);
    len += l.length + 1;
    if (len > maxChars) break;
  }
  const result = out.join('\n').trim();
  return result || null;
}
