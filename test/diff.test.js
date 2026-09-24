import { test } from 'node:test';
import assert from 'node:assert/strict';
import './setup.js';
import { normalizeAssignment, normalizeFeedback, formatScore } from '../src/lib/normalize.js';
import { diffSnapshots } from '../src/lib/diff.js';
import { buildView } from '../src/lib/feed.js';
import { DEFAULT_SETTINGS } from '../src/lib/config.js';

const now = new Date(2026, 8, 23, 10, 0);
const enr = { id: '7001', className: 'Grade 5 Math', href: 'https://portals.veracross.com/ebgis/parent/student/1/classes/7001/assignments', ok: { assignments: true, feedback: true } };

function raw(id, extra = {}) {
  return {
    assignment_id: id, assignment_type: 'Classwork', assignment_description: `A${id}`, assignment_notes: '',
    _date: '09/25/2026', due_date_long: 'Friday, September 25, 2026', assignment_date_long: 'Monday, September 21, 2026',
    completion_status: 'Pending', raw_score: '', percent_grade: '', letter_grade: '', maximum_score: '', ...extra,
  };
}

function snapshot(assignments, feedback = [], { takenAt = now.getTime(), updates = {}, messages = {}, ok = true } = {}) {
  const e = { ...enr, ok: { assignments: ok, feedback: ok } };
  const child = { id: '1', name: 'Ada Example', enrollments: [e], assignments: {}, feedback: {}, updates, warnings: [], errors: [] };
  const titles = new Map();
  for (const r of assignments) { const a = normalizeAssignment(r, e); child.assignments[a.key] = a; titles.set(a.id, a.title); }
  for (const f of feedback) { const n = normalizeFeedback(f, e, titles, now); child.feedback[n.id] = n; }
  return { school: 'ebgis', takenAt, children: [child], messages, warnings: [], errors: [] };
}

test('normalizeAssignment', () => {
  const a = normalizeAssignment(raw(1, { raw_score: '17', maximum_score: '20', percent_grade: '85', assignment_notes: '<p>Bring a ruler</p>' }), enr);
  assert.equal(a.key, '7001:1');
  assert.equal(a.due, '2026-09-25');
  assert.equal(a.assigned, '2026-09-21');
  assert.equal(a.score, '17/20 · 85%');
  assert.equal(a.notes, 'Bring a ruler');
  assert.equal(formatScore({}), '');
});

test('first run: only recent items are new', () => {
  const latest = snapshot([raw(1), raw(2, { assignment_date_long: 'Monday, August 24, 2026', _date: '08/28/2026' })]);
  const d = diffSnapshots(null, latest, { lookbackDays: 14, now: now.getTime() });
  assert.deepEqual(d.children['1'].newAssignments, ['7001:1']);
  assert.equal(d.comparedTo, null);
});

test('new, changed and removed assignments; new feedback', () => {
  const fb = { feedback_id: 900, assignment_id: 1, person_record_type: 'teacher', feedback_date: 'Sep 22 @ 3:10 P', feedback_message: 'Well done!' };
  const before = snapshot([raw(1), raw(2), raw(3)], [], { takenAt: now.getTime() - 86400000 });
  const after = snapshot([raw(1, { _date: '09/29/2026', completion_status: 'Complete', raw_score: 9, maximum_score: 10 }), raw(2), raw(4)], [fb]);
  const d = diffSnapshots(before, after, { now: now.getTime() }).children['1'];
  assert.deepEqual(d.newAssignments, ['7001:4']);
  assert.deepEqual(d.removedAssignments.map((a) => a.key), ['7001:3']);
  assert.deepEqual(d.newFeedback, ['900']);
  const ch = d.changedAssignments[0];
  assert.equal(ch.key, '7001:1');
  assert.deepEqual(ch.changes.map((c) => [c.field, c.before, c.after]), [
    ['due', '2026-09-25', '2026-09-29'],
    ['status', 'Pending', 'Complete'],
    ['score', '', '9/10'],
  ]);
});

test('no removals reported for a class that failed to load', () => {
  const before = snapshot([raw(1), raw(2)], [], { takenAt: now.getTime() - 86400000 });
  const after = snapshot([], [], { ok: false });
  const d = diffSnapshots(before, after, { now: now.getTime() }).children['1'];
  assert.deepEqual(d.removedAssignments, []);
});

test('buildView: feed order, action items, upcoming', () => {
  const fb = { feedback_id: 900, assignment_id: 1, person_record_type: 'teacher', feedback_date: 'Sep 22 @ 3:10 P', feedback_message: 'Well done!\n\nKeep going.' };
  const updates = {
    k1: { key: 'k1', date: '2026-09-22', type: 'DAILY ATTENDANCE', text: 'Absent - Excused', href: null },
    k2: { key: 'k2', date: '2026-09-21', type: 'NEW POST', text: 'PE: Climbing trip', href: 'https://classes.veracross.com/ebgis/course/1/website/posts/7',
      post: { text: 'The signed waiver is needed by Thursday morning.' } },
  };
  const before = snapshot([raw(1)], [], { takenAt: now.getTime() - 86400000 });
  const after = snapshot([raw(1, { _date: '09/24/2026' }), raw(5, { assignment_date_long: 'Tuesday, September 22, 2026' })], [fb], { updates });
  const diff = diffSnapshots(before, after, { now: now.getTime() });
  const view = buildView(after, diff, DEFAULT_SETTINGS, now);

  const feed = view.children[0].items;
  assert.equal(feed[0].kind, 'feedback'); // Sep 22 15:10 is the newest timestamp
  assert.equal(feed[0].body, 'Well done!\n\nKeep going.'); // verbatim
  assert.ok(feed.every((it, i) => i === 0 || feed[i - 1].ts >= it.ts));

  const reasons = view.action.needs.map((n) => n.reason).sort();
  assert.deepEqual(reasons, ['Due date changed', 'New attendance entry', 'Post mentions a deadline']);
  assert.deepEqual(view.action.upcoming.map((u) => u.title), ['A1', 'A5']);
  assert.equal(view.total, diff.total);
});

test('feed titles use the portal\'s labelled update fields when present', () => {
  const updates = {
    p: { key: 'p', date: '2026-09-22', type: 'NEW POST', text: 'G5PE26: Grade 5 Physical Education Rivera\nClimbing Hall Waiver', href: null,
      className: 'Grade 5 Physical Education', teacher: 'Rivera', description: 'Climbing Hall Waiver' },
    a: { key: 'a', date: '2026-09-22', type: 'DAILY ATTENDANCE', text: 'Absence\nAbsent - Excused', href: null, detail: 'Absence', description: 'Absent - Excused' },
  };
  const snap = snapshot([], [], { updates });
  const items = buildView(snap, diffSnapshots(null, snap, { now: now.getTime() }), DEFAULT_SETTINGS, now).children[0].items;
  const post = items.find((i) => i.kind === 'post');
  const att = items.find((i) => i.kind === 'attendance');
  assert.deepEqual([post.title, post.context], ['Climbing Hall Waiver', 'Grade 5 Physical Education · Rivera']);
  assert.deepEqual([att.title, att.context], ['Absent - Excused', 'Absence · Daily Attendance']);
});
