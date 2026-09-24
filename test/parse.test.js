import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, doc } from './setup.js';
import { parseChildren, parseStudentName, parseEnrollments, parseRecentUpdates, parseMessageList, parseMessageDetail, looksLikeLoginPage } from '../src/lib/parse.js';
import { htmlToText, findDeadlineLines, extractSection } from '../src/lib/text.js';

const now = new Date(2026, 8, 23, 10, 0);
const base = 'https://portals.veracross.com/ebgis/parent';

test('children come from overview links, named by the nearest heading', () => {
  const { children, warnings } = parseChildren(doc(fixture('parent-home.html')), 'ebgis');
  assert.deepEqual(children.map((c) => [c.id, c.name]), [['4201', 'Ada Example'], ['4202', 'Leo Example']]);
  assert.deepEqual(warnings, []);
});

test('section headings like "Classes & Grades" are never taken as a child name', () => {
  const { children } = parseChildren(doc(fixture('parent-home-sections.html')), 'ebgis');
  assert.deepEqual(children.map((c) => [c.id, c.name, c.nameFound]), [['4201', 'Ada Example', true], ['4202', 'Leo Example', true]]);
});

test('real EBGIS home page layout: names from h4.vx-child-name, not "Classes & Reports" link text', () => {
  const { children, warnings } = parseChildren(doc(fixture('parent-home-ebgis.html')), 'ebgis');
  assert.deepEqual(children.map((c) => [c.id, c.name, c.nameFound]), [['4201', 'Ada', true], ['4202', 'Leo', true]]);
  assert.deepEqual(warnings, []);
});

test('a heading shared by every child is rejected even without nav words', () => {
  const html = `<body>
    <h4>Ada Example</h4><h5>Quick Links</h5><a href="/ebgis/parent/student/1/overview">Overview</a>
    <h4>Leo Example</h4><h5>Quick Links</h5><a href="/ebgis/parent/student/2/overview">Overview</a></body>`;
  assert.deepEqual(parseChildren(doc(html), 'ebgis').children.map((c) => c.name), ['Ada Example', 'Leo Example']);
});

test('no usable name falls back to a placeholder; overview page supplies the real one', () => {
  const html = `<body><h3>Classes</h3><a href="/ebgis/parent/student/1/overview">Overview</a></body>`;
  const [c] = parseChildren(doc(html), 'ebgis').children;
  assert.deepEqual([c.name, c.nameFound], ['Student 1', false]);
  assert.equal(parseStudentName(doc('<!doctype html><html><head><title>Ada Example - Overview</title></head><body><h1>Classes</h1></body></html>')), 'Ada Example');
  assert.equal(parseStudentName(doc('<body><h1>Ada Example</h1></body>')), 'Ada Example');
});

test('enrollments get class names by DOM proximity, then nearby text', () => {
  const { enrollments } = parseEnrollments(doc(fixture('overview.html')), `${base}/student/4201/overview`);
  assert.deepEqual(enrollments.map((e) => [e.id, e.className, e.courseId, e.nameSource]), [
    ['7001', 'Grade 5 Math', '301', 'proximity'],
    ['7002', 'Deutsch 5', '302', 'proximity'],
    ['7003', 'Homeroom 5B', null, 'nearby-text'],
  ]);
  assert.equal(enrollments[0].href, 'https://portals.veracross.com/ebgis/parent/student/4201/classes/7001/assignments');
});

test('recent updates are grouped under date headings', () => {
  const { entries } = parseRecentUpdates(doc(fixture('recent-updates.html')), `${base}/student/4201/recent-updates`, now);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((e) => [e.date, e.type, e.text]), [
    ['2026-09-22', 'DAILY ATTENDANCE', 'Absent - Excused'],
    ['2026-09-22', 'NEW POST', 'PE Grade 5: Climbing hall trip'],
    ['2026-09-18', 'NEW POST', 'Grade 5 Math: Practice sheet'],
  ]);
  assert.equal(entries[1].href, 'https://classes.veracross.com/ebgis/course/305/website/posts/7');
  // Keys are stable across parses.
  const again = parseRecentUpdates(doc(fixture('recent-updates.html')), base, now).entries;
  assert.deepEqual(again.map((e) => e.key), entries.map((e) => e.key));
});

test('real EBGIS recent updates: labelled fields and date groups', () => {
  const { entries, warnings } = parseRecentUpdates(doc(fixture('recent-updates-ebgis.html')), `${base}/student/4201/recent-updates`, now);
  assert.deepEqual(warnings, []);
  assert.deepEqual(entries.map((e) => [e.date, e.type, e.className, e.teacher, e.detail, e.description]), [
    ['2026-09-22', 'NEW POST', 'Grade 5 Physical Education', 'Rivera', undefined, 'Climbing Hall Waiver'],
    ['2026-09-22', 'DAILY ATTENDANCE', undefined, undefined, 'Absence', 'Absent - Excused'],
    ['2026-09-18', 'NEW POST', 'Grade 5 Mathematics', 'Okafor', undefined, 'Decimals practice sheet'],
  ]);
  assert.equal(entries[0].href, 'https://classes.veracross.com/ebgis/course/555/website/posts/7');
});

test('real EBGIS message list: subject, sender, category and date from labelled fields', () => {
  const { messages } = parseMessageList(doc(fixture('messages-ebgis.html')), 'ebgis', `${base}/messages`, now);
  assert.deepEqual(messages.map((m) => [m.id, m.title, m.from, m.category, m.date]), [
    ['9002', 'Reminder: Picture Day Tomorrow', 'School Communications', 'Group Distribution List', '2026-09-22'],
    ['9001', 'Weekly news (September 4, 2026)', 'School Communications', 'Weekly School Newsletter', '2026-09-04'],
  ]);
});

test('real EBGIS message detail: header fields, body only, events section', () => {
  const d = parseMessageDetail(doc(fixture('message-detail-ebgis.html')), now);
  assert.equal(d.subject, 'Weekly news (September 4, 2026)');
  assert.equal(d.sender, 'communications@school.example'); // not "THE PRINCIPAL'S DESK"
  assert.equal(d.sent, '2026-09-04');
  assert.match(d.text, /^Community News/);
  assert.doesNotMatch(d.text, /Date Sent/);
  const events = extractSection(d.text);
  assert.match(events, /^Monday, September 7\nLabor Day/);
  assert.match(events, /sign up by Friday/);
});

test('message list', () => {
  const { messages } = parseMessageList(doc(fixture('messages.html')), 'ebgis', `${base}/messages`, now);
  assert.deepEqual(messages.map((m) => [m.id, m.title, m.date]), [
    ['3302', 'Newsletter — Week 5', '2026-09-21'],
    ['3301', 'Welcome back picnic photos', '2026-09-12'],
  ]);
});

test('message detail: body, sender, date, events section', () => {
  const d = parseMessageDetail(doc(fixture('message-detail.html')), now);
  assert.equal(d.subject, 'Newsletter — Week 5');
  assert.equal(d.sender, 'Head of Primary');
  assert.equal(d.sent, '2026-09-21');
  assert.match(d.text, /^Dear families,/);
  const events = extractSection(d.text);
  assert.match(events, /RSVP by Tuesday/);
  assert.match(events, /waiver due Thursday/);
  assert.doesNotMatch(events, /overflowing/);
});

test('login page detection', () => {
  assert.ok(looksLikeLoginPage('<form><input type="password" name="p"></form>'));
  assert.ok(!looksLikeLoginPage(fixture('overview.html')));
});

test('htmlToText keeps words verbatim and line breaks', () => {
  assert.equal(htmlToText('Plain text\nwith a break'), 'Plain text\nwith a break');
  assert.equal(htmlToText('<p>Sehr schön!</p><p>Weiter&nbsp;so &amp; gut</p>'), 'Sehr schön!\n\nWeiter so & gut');
  assert.equal(htmlToText('a<br>b'), 'a\nb');
});

test('deadline lines', () => {
  const text = 'Next Friday we go climbing.\n\nThe signed waiver is needed by Thursday morning, otherwise your child stays at school.\nHave fun!';
  assert.deepEqual(findDeadlineLines(text), ['The signed waiver is needed by Thursday morning, otherwise your child stays at school.']);
  assert.deepEqual(findDeadlineLines('Bitte das Formular bis Freitag abgeben.'), ['Bitte das Formular bis Freitag abgeben.']);
  assert.deepEqual(findDeadlineLines('We had a lovely day.'), []);
});
