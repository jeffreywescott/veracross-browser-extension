// Made-up data for trying the dashboard outside the extension (serve the repo and open
// src/pages/dashboard.html). Nothing here is real student data.

import { normalizeAssignment, normalizeFeedback } from '../lib/normalize.js';
import { _area, saveSettings } from '../lib/store.js';
import { toISODate, addDays, startOfDay } from '../lib/dates.js';
import { hash } from '../lib/text.js';
import { SNAPSHOT_VERSION } from '../lib/collect.js';

const SCHOOL = 'demo';
const now = new Date();
const day = (n) => addDays(startOfDay(now), n);
const mdy = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
const long = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const fbDate = (d, h, m) => `${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getDate()} @ ${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'P' : 'A'}`;

function rawAssignment(id, title, type, assigned, due, extra = {}) {
  return {
    assignment_id: id, score_id: id * 10, assignment_type: type, assignment_description: title,
    assignment_notes: '', _date: mdy(due), due_date_long: long(due), assignment_date_long: long(assigned),
    grading_period: 'Term 1', completion_status: 'Pending', completion_status_id: 1, raw_score: '', percent_grade: '',
    letter_grade: '', maximum_score: '', points_possible: '', include_in_calculated_grade: 1, extra_credit: '',
    num_feedback: 0, num_attachments: 0, num_criteria: 0, dropbox_status: '', ...extra,
  };
}

function child(id, name, classes, assignmentsByClass, feedbackByClass, updates) {
  const enrollments = classes.map(([eid, className, courseId]) => ({
    id: String(eid), className, courseId: String(courseId), nameSource: 'proximity',
    href: `https://portals.veracross.com/${SCHOOL}/parent/student/${id}/classes/${eid}/assignments`,
    ok: { assignments: true, feedback: true },
  }));
  const c = { id: String(id), name, enrollments, assignments: {}, feedback: {}, updates: {}, warnings: [], errors: [] };
  for (const enr of enrollments) {
    const titles = new Map();
    for (const raw of assignmentsByClass[enr.id] || []) {
      const a = normalizeAssignment(raw, enr);
      c.assignments[a.key] = a;
      titles.set(a.id, a.title);
    }
    for (const raw of feedbackByClass[enr.id] || []) {
      const f = normalizeFeedback(raw, enr, titles, now);
      c.feedback[f.id] = f;
    }
  }
  for (const u of updates) {
    const key = hash(`${u.date}|${u.type}|${u.text}`);
    c.updates[key] = { key, firstSeen: now.getTime(), post: null, href: null, ...u };
  }
  return c;
}

function build(latest) {
  // Ada: grade 5
  const adaMath = [
    rawAssignment(9101, 'Fractions quiz', 'Summative Assessment', day(-12), day(-5), { completion_status: 'Complete', raw_score: 17, maximum_score: 20, percent_grade: 85, num_feedback: 1 }),
    rawAssignment(9102, 'Workbook p. 42–44', 'Classwork', day(-6), day(-2), { completion_status: latest ? 'Complete' : 'Pending' }),
    rawAssignment(9103, 'Decimals unit test', 'Summative Assessment', day(-4), latest ? day(4) : day(2), {
      assignment_notes: 'Unit test on decimals: comparing, rounding, adding and subtracting.\n\nPlease review the practice sheet from Friday. Calculators are not allowed.',
    }),
    ...(latest ? [rawAssignment(9104, 'Math journal reflection', 'Formative Assessment', day(-1), day(3), { assignment_notes: 'Write half a page: Where do you see decimals outside of school?' })] : []),
    rawAssignment(9099, 'Place value warm-up', 'Classwork', day(-30), day(-28), { completion_status: 'Complete' }),
  ];
  const adaGerman = [
    rawAssignment(9201, 'Lesetagebuch Kapitel 3', 'Formative Assessment', day(-8), day(-1), {
      assignment_notes: 'Lies Kapitel 3 von „Die unendliche Geschichte“ und schreibe fünf Sätze in dein Lesetagebuch.\nWas hat Bastian gefühlt?',
      completion_status: 'Pending',
    }),
    rawAssignment(9202, 'Diktat', 'Summative Assessment', day(-3), day(1), { assignment_notes: 'Wörter mit ie und ih. Übt bitte die Liste zu Hause.' }),
  ];
  const adaFeedbackMath = [
    { feedback_id: 55001, assignment_id: 9101, person_record_type: 'teacher', feedback_person: '', feedback_date: fbDate(day(-4), 21, 28),
      feedback_message: 'Great progress on equivalent fractions! Watch the denominators when adding — questions 6 and 9 had the same small slip. Let’s practice that together on Tuesday.' },
  ];
  const adaFeedbackGerman = latest
    ? [{ feedback_id: 55002, assignment_id: 9201, person_record_type: 'teacher', feedback_person: '', feedback_date: fbDate(day(-1), 15, 5),
        feedback_message: 'Sehr schöne Einträge, Ada! Bitte achte noch auf die Großschreibung am Satzanfang.\n\nWeiter so!' }]
    : [];
  const adaUpdates = [
    { date: toISODate(day(-9)), type: 'DAILY ATTENDANCE', text: 'Absent - Excused' },
    { date: toISODate(day(-6)), type: 'NEW POST', text: 'Grade 5 Math\nNew post: Practice sheet for the decimals test', href: `https://classes.veracross.com/${SCHOOL}/course/301/website/posts/12` },
    ...(latest ? [
      { date: toISODate(day(-1)), type: 'NEW POST', text: 'PE Grade 5\nNew post: Climbing hall trip next week', href: `https://classes.veracross.com/${SCHOOL}/course/305/website/posts/7`,
        post: { text: 'Next Friday we are going to the climbing hall with both Grade 5 classes.\n\nThe signed waiver is needed by Thursday morning, otherwise your child will stay at school.\nPlease bring sports clothes, water and a snack.' } },
    ] : []),
  ];

  // Leo: grade 2
  const leoClass = [
    rawAssignment(8101, 'Reading log week 3', 'Classwork', day(-10), day(-3), { completion_status: 'Complete' }),
    rawAssignment(8102, 'Show & tell: my favorite animal', 'Class Participation', day(-5), day(2), {
      assignment_notes: 'Bring a picture or small object about your favorite animal. Each child will talk for about 1 minute.',
    }),
    rawAssignment(8103, 'Spelling words list 4', 'Classwork', day(-2), day(5)),
  ];
  const leoMusic = latest ? [] : [rawAssignment(8201, 'Recorder practice', 'Classwork', day(-6), day(6))];
  const leoFeedback = [
    { feedback_id: 56001, assignment_id: 8101, person_record_type: 'teacher', feedback_person: '', feedback_date: fbDate(day(-3), 16, 40),
      feedback_message: 'Leo read every day this week and wrote a sentence about each book. Wonderful!' },
  ];
  const leoUpdates = [
    ...(latest ? [{ date: toISODate(day(0)), type: 'DAILY ATTENDANCE', text: 'Tardy - Excused' }] : []),
  ];

  const children = [
    child(4201, 'Ada Example', [[7001, 'Grade 5 Math', 301], [7002, 'Deutsch 5', 302]], { 7001: adaMath, 7002: adaGerman }, { 7001: adaFeedbackMath, 7002: adaFeedbackGerman }, adaUpdates),
    child(4202, 'Leo Example', [[7101, 'Grade 2 Homeroom', 401], [7102, 'Music 2', 402]], { 7101: leoClass, 7102: leoMusic }, { 7101: leoFeedback }, leoUpdates),
  ];

  const messages = {
    3301: { id: '3301', title: 'Welcome back picnic photos', date: toISODate(day(-11)), href: `https://portals.veracross.com/${SCHOOL}/parent/detail/email/3301`, firstSeen: now.getTime(),
      detail: { subject: 'Welcome back picnic photos', sender: 'Primary School Office', text: 'Thank you to everyone who came to the picnic! Photos are in the parent gallery.', events: null } },
  };
  if (latest) {
    messages[3302] = {
      id: '3302', title: 'Newsletter — Week 5', date: toISODate(day(-2)), href: `https://portals.veracross.com/${SCHOOL}/parent/detail/email/3302`, firstSeen: now.getTime(),
      detail: {
        subject: 'Newsletter — Week 5', sender: 'Head of Primary',
        text: 'Dear families,\n\nWhat a busy start to the term! Our Grade 5 students have started their exhibition projects, and Grade 2 has been exploring the school garden.\n\nUpcoming Events Overview\n\nMon: Picture day (Primary)\nWed: Parent coffee morning, 8:15 in the library. Please RSVP by Tuesday.\nFri: Grade 5 climbing trip — waiver due Thursday morning\n\nLOST PROPERTY\n\nThe lost property box is overflowing. Please check it before the October break.',
        events: 'Mon: Picture day (Primary)\nWed: Parent coffee morning, 8:15 in the library. Please RSVP by Tuesday.\nFri: Grade 5 climbing trip — waiver due Thursday morning',
      },
    };
  }

  return {
    version: SNAPSHOT_VERSION, school: SCHOOL, takenAt: latest ? now.getTime() - 5 * 60000 : day(-4).getTime(),
    children, messages, warnings: [], errors: [], stats: { requests: 34, modes: { 'portals.veracross.com': 'direct', 'portals-embed.veracross.com': 'direct' } },
  };
}

export async function seedDemo() {
  const baseline = build(false);
  const latest = build(true);
  await saveSettings({ school: SCHOOL });
  const history = [{
    seenAt: day(-4).getTime(), snapshotAt: baseline.takenAt, total: 2,
    children: [{ name: 'Ada Example', items: [{ kind: 'feedback', state: 'new', title: 'Feedback on “Fractions quiz”', context: 'Grade 5 Math' }] }],
    messages: [{ kind: 'message', state: 'new', title: 'Welcome back picnic photos' }],
  }];
  await _area.set({
    [`baseline:${SCHOOL}`]: baseline,
    [`latest:${SCHOOL}`]: latest,
    [`history:${SCHOOL}`]: history,
    [`status:${SCHOOL}`]: { lastRefresh: latest.takenAt },
  });
}
