// Turns a snapshot + diff into what the dashboard shows: one reverse-chronological feed per
// child, and the Action items tab. Pure; the dashboard only renders this.

import { fromISODate, startOfDay, addDays, DAY_MS } from './dates.js';
import { findDeadlineLines } from './text.js';
import { urls } from './config.js';

export const KINDS = {
  assignment: 'Assignment',
  feedback: 'Feedback',
  attendance: 'Attendance',
  post: 'Class post',
  update: 'Update',
  message: 'School message',
};

const tsOf = (iso) => fromISODate(iso)?.getTime() ?? null;
const DONE = /^(complete|completed|nreq|not required|excused|turned in|submitted)$/i;

function assignmentItem(a, child, school, state = null, changes = null) {
  const meta = [];
  if (a.type) meta.push(['Type', a.type]);
  if (a.due) meta.push(['Due', a.dueLabel || a.due]);
  if (a.status) meta.push(['Status', a.status]);
  if (a.score) meta.push(['Score', a.score]);
  if (a.numAttachments) meta.push(['Attachments', String(a.numAttachments)]);
  if (a.gradingPeriod) meta.push(['Period', a.gradingPeriod]);
  const enr = child.enrollments.find((e) => e.id === a.enrollmentId);
  return {
    id: `a:${a.key}`,
    childId: child.id,
    kind: 'assignment',
    ts: tsOf(a.assigned) ?? tsOf(a.due) ?? 0,
    dateOnly: true,
    title: a.title,
    context: a.className,
    body: a.notes,
    bodyLabel: a.notes ? 'Teacher notes' : null,
    meta,
    state,
    changes,
    due: a.due,
    status: a.status,
    stale: !!a.stale,
    link: enr?.href || urls.classAssignmentsPage(school, child.id, a.enrollmentId),
  };
}

function feedbackItem(f, child, school) {
  return {
    id: `f:${f.id}`,
    childId: child.id,
    kind: 'feedback',
    ts: f.ts ?? 0,
    dateOnly: false,
    title: f.assignmentTitle ? `Feedback on “${f.assignmentTitle}”` : 'Teacher feedback',
    context: f.className,
    body: f.message,
    bodyLabel: null,
    verbatim: true,
    meta: f.from ? [['From', f.from]] : [],
    dateLabel: f.dateLabel,
    link: urls.classAssignmentsPage(school, child.id, f.enrollmentId),
  };
}

function updateItem(u, child) {
  const isAttendance = /ATTENDANCE/i.test(u.type);
  const isPost = /POST/i.test(u.type) || /\/website\/posts\/\d+/.test(u.href || '');
  const kind = isAttendance ? 'attendance' : isPost ? 'post' : 'update';
  const lines = u.text.split('\n').filter(Boolean);
  let title;
  let context = null;
  let body;
  if (u.description || u.className) {
    // Labelled fields from the portal (see updateFields in parse.js).
    title = u.description || u.detail || u.className;
    context = isAttendance
      ? [u.detail, u.type && titleCase(u.type)].filter(Boolean).join(' · ') || null
      : [u.className, u.teacher].filter(Boolean).join(' · ') || null;
    body = u.post?.text || '';
  } else if (isAttendance) {
    title = lines[0] || 'Attendance';
    context = u.type;
    body = lines.slice(1).join('\n');
  } else if (lines.length > 1) {
    // Usually "<class name>" then "<post title>".
    context = lines[0];
    title = lines[1].replace(/^new post:\s*/i, '');
    body = u.post?.text || lines.slice(2).join('\n');
  } else {
    title = (lines[0] || u.type).replace(/^new post:\s*/i, '');
    body = u.post?.text || '';
  }
  const deadlines = kind === 'attendance' ? [] : findDeadlineLines(`${u.text}\n${u.post?.text || ''}`);
  return {
    id: `u:${u.key}`,
    childId: child.id,
    kind,
    ts: tsOf(u.date) ?? u.firstSeen ?? 0,
    dateOnly: true,
    title,
    context,
    body,
    bodyLabel: u.post?.text ? 'Post' : null,
    meta: [],
    deadlines,
    link: u.href,
    postMissing: kind === 'post' && !u.post?.text,
  };
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

function messageItem(m) {
  const d = m.detail;
  const meta = [];
  if (d?.sender || m.from) meta.push(['From', d?.sender || m.from]);
  if (m.category) meta.push(['List', m.category]);
  const text = d?.text || m.preview || '';
  return {
    id: `m:${m.id}`,
    childId: null,
    kind: 'message',
    ts: tsOf(m.date) ?? m.firstSeen ?? 0,
    dateOnly: true,
    title: m.title || d?.subject || 'School message',
    context: null,
    body: text,
    bodyLabel: null,
    collapsed: true,
    events: d?.events || null,
    meta,
    deadlines: findDeadlineLines(d?.events || text, 6),
    link: m.href,
  };
}

export function buildView(snapshot, diff, settings, now = new Date()) {
  const school = snapshot.school;
  const today = startOfDay(now).getTime();
  const children = [];
  const action = { needs: [], whatsNew: [], upcoming: [], pastDue: [], newMessages: [] };

  const messages = Object.values(snapshot.messages || {}).map(messageItem);
  const newMsgIds = new Set((diff?.newMessages || []).map((id) => `m:${id}`));
  for (const m of messages) if (newMsgIds.has(m.id)) m.state = 'new';

  for (const child of snapshot.children) {
    const d = diff?.children?.[child.id] || { newAssignments: [], changedAssignments: [], removedAssignments: [], newFeedback: [], newUpdates: [] };
    const newA = new Set(d.newAssignments);
    const changedA = new Map(d.changedAssignments.map((c) => [c.key, c.changes]));
    const newF = new Set(d.newFeedback);
    const newU = new Set(d.newUpdates);

    const items = [];
    for (const a of Object.values(child.assignments)) {
      const state = newA.has(a.key) ? 'new' : changedA.has(a.key) ? 'changed' : null;
      items.push(assignmentItem(a, child, school, state, changedA.get(a.key) || null));
    }
    for (const a of d.removedAssignments) items.push(assignmentItem(a, child, school, 'removed'));
    for (const f of Object.values(child.feedback)) {
      const it = feedbackItem(f, child, school);
      if (newF.has(f.id)) it.state = 'new';
      items.push(it);
    }
    for (const u of Object.values(child.updates)) {
      const it = updateItem(u, child);
      if (newU.has(u.key)) it.state = 'new';
      items.push(it);
    }
    for (const m of messages) items.push({ ...m, childId: child.id });

    items.sort((x, y) => y.ts - x.ts || kindOrder(x.kind) - kindOrder(y.kind));
    const fresh = items.filter((i) => i.state && i.kind !== 'message');
    children.push({ id: child.id, name: child.name, items, newCount: fresh.length, warnings: child.warnings, errors: child.errors, enrollments: child.enrollments, counts: countsOf(child) });

    // Action items ---------------------------------------------------------------
    if (fresh.length) action.whatsNew.push({ child: { id: child.id, name: child.name }, items: fresh.slice().sort(stateThenDate) });

    for (const it of fresh) {
      if (it.kind === 'attendance') action.needs.push({ ...it, reason: 'New attendance entry' });
      else if ((it.kind === 'post' || it.kind === 'update') && it.deadlines?.length) action.needs.push({ ...it, reason: 'Post mentions a deadline' });
      else if (it.kind === 'assignment' && it.state === 'changed' && it.changes?.some((c) => c.field === 'due')) action.needs.push({ ...it, reason: 'Due date changed' });
    }

    const horizon = addDays(today, settings.dueSoonDays).getTime();
    for (const it of items) {
      if (it.kind !== 'assignment' || !it.due || it.state === 'removed') continue;
      const due = tsOf(it.due);
      if (due >= today && due <= horizon && !/^(nreq|not required)$/i.test(it.status || '')) {
        action.upcoming.push({ ...it, childName: child.name });
      } else if (due < today && due >= today - 14 * DAY_MS && /^pending$/i.test(it.status || '')) {
        action.pastDue.push({ ...it, childName: child.name });
      }
    }
  }

  for (const m of messages) {
    if (m.state !== 'new') continue;
    action.newMessages.push(m);
    if (m.deadlines.length) action.needs.push({ ...m, reason: 'Message mentions dates or deadlines' });
  }

  const nameOf = new Map(children.map((c) => [c.id, c.name]));
  for (const it of action.needs) it.childName = it.childId ? nameOf.get(it.childId) : null;
  action.upcoming.sort((a, b) => tsOf(a.due) - tsOf(b.due) || (DONE.test(a.status) ? 1 : 0) - (DONE.test(b.status) ? 1 : 0));
  action.pastDue.sort((a, b) => tsOf(b.due) - tsOf(a.due));
  action.needs.sort((a, b) => b.ts - a.ts);

  return { children, action, messages, total: diff?.total ?? 0 };
}

function kindOrder(k) {
  return ['message', 'attendance', 'post', 'update', 'feedback', 'assignment'].indexOf(k);
}

function stateThenDate(a, b) {
  const order = { new: 0, changed: 1, removed: 2 };
  const kinds = { feedback: 0, attendance: 1, post: 2, update: 3, assignment: 4 };
  return (kinds[a.kind] - kinds[b.kind]) || (order[a.state] - order[b.state]) || b.ts - a.ts;
}

function countsOf(child) {
  return {
    classes: child.enrollments.length,
    assignments: Object.keys(child.assignments).length,
    feedback: Object.keys(child.feedback).length,
    updates: Object.keys(child.updates).length,
  };
}

export function isDone(status) {
  return DONE.test(status || '');
}

// Compact record of a dismissed digest, kept in history.
export function digestEntry(view, snapshot) {
  const pick = (it) => ({ kind: it.kind, state: it.state, title: it.title, context: it.context, childName: it.childName || null, changes: it.changes || null, ts: it.ts });
  return {
    seenAt: Date.now(),
    snapshotAt: snapshot.takenAt,
    total: view.total,
    children: view.action.whatsNew.map((g) => ({ name: g.child.name, items: g.items.map(pick) })),
    messages: view.action.newMessages.map(pick),
  };
}
