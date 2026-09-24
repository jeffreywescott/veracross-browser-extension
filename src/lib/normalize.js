// Turns raw Veracross JSON into the compact records we store and diff.

import { parseMDY, parseLooseDate, parseFeedbackDate, toISODate } from './dates.js';
import { htmlToText, oneLine } from './text.js';

const str = (v) => (v == null ? '' : String(v));
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

export function formatScore(a) {
  const raw = num(a.raw_score);
  const max = num(a.maximum_score) ?? num(a.points_possible);
  const pct = num(a.percent_grade);
  const letter = oneLine(a.letter_grade);
  const parts = [];
  if (raw != null) parts.push(max != null ? `${raw}/${max}` : `${raw}`);
  if (pct != null) parts.push(`${Math.round(pct * 10) / 10}%`);
  if (letter) parts.push(letter);
  return parts.join(' · ');
}

export function normalizeAssignment(a, enrollment) {
  const due = parseMDY(a._date) || parseLooseDate(a.due_date_long);
  const assigned = parseLooseDate(a.assignment_date_long) || parseMDY(a.assignment_date);
  return {
    key: `${enrollment.id}:${a.assignment_id}`,
    id: str(a.assignment_id),
    enrollmentId: enrollment.id,
    className: enrollment.className,
    title: oneLine(a.assignment_description) || 'Untitled assignment',
    notes: htmlToText(a.assignment_notes),
    type: oneLine(a.assignment_type),
    due: toISODate(due),
    dueLabel: oneLine(a.due_date_long) || str(a._date),
    assigned: toISODate(assigned),
    status: oneLine(a.completion_status),
    score: formatScore(a),
    counted: a.include_in_calculated_grade == null ? null : [true, 1, '1', 'true', 'Y', 'y'].includes(a.include_in_calculated_grade),
    extraCredit: [true, 1, '1', 'true', 'Y', 'y'].includes(a.extra_credit),
    numFeedback: num(a.num_feedback) ?? 0,
    numAttachments: num(a.num_attachments) ?? 0,
    dropbox: oneLine(a.dropbox_status),
    gradingPeriod: oneLine(a.grading_period),
  };
}

export function normalizeFeedback(f, enrollment, assignmentTitles, now = new Date()) {
  const when = parseFeedbackDate(f.feedback_date, now);
  const aid = str(f.assignment_id);
  return {
    id: str(f.feedback_id),
    assignmentId: aid,
    assignmentKey: aid ? `${enrollment.id}:${aid}` : null,
    assignmentTitle: assignmentTitles.get(aid) || null,
    enrollmentId: enrollment.id,
    className: enrollment.className,
    from: oneLine(f.feedback_person) || (f.person_record_type ? capitalize(f.person_record_type) : ''),
    dateLabel: oneLine(f.feedback_date),
    ts: when ? when.getTime() : null,
    // Shown verbatim. Only markup is removed; the words are untouched.
    message: htmlToText(f.feedback_message),
  };
}

function capitalize(s) {
  const t = oneLine(s);
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

// Fields compared between snapshots, in display order.
export const ASSIGNMENT_FIELDS = [
  ['due', 'Due date'],
  ['status', 'Status'],
  ['score', 'Score'],
  ['title', 'Title'],
  ['type', 'Type'],
  ['notes', 'Notes'],
];
