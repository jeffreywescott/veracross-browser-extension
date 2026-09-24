// Compares the latest snapshot with the baseline (what the parent last marked as seen).
// Pure function: no storage, no DOM.
//
// With no baseline (first run, or a child/message source we've never seen) everything is
// "already known" except items dated within `lookbackDays`, so the first digest isn't a wall
// of a whole school year.

import { ASSIGNMENT_FIELDS } from './normalize.js';
import { fromISODate, DAY_MS } from './dates.js';

function recent(isoOrTs, cutoff) {
  if (isoOrTs == null) return false;
  const t = typeof isoOrTs === 'number' ? isoOrTs : fromISODate(isoOrTs)?.getTime();
  return t != null && t >= cutoff;
}

export function diffSnapshots(baseline, latest, { lookbackDays = 14, now = Date.now() } = {}) {
  const cutoff = now - lookbackDays * DAY_MS;
  const out = { comparedTo: baseline?.takenAt ?? null, children: {}, newMessages: [], total: 0 };

  for (const child of latest?.children || []) {
    const prev = baseline?.children?.find((c) => c.id === child.id) || null;
    const d = { newAssignments: [], changedAssignments: [], removedAssignments: [], newFeedback: [], newUpdates: [], total: 0 };

    for (const a of Object.values(child.assignments)) {
      const old = prev?.assignments?.[a.key];
      if (!prev) {
        // Assignments are "recent" if assigned (or, lacking that, due) inside the window.
        if (recent(a.assigned || a.due, cutoff)) d.newAssignments.push(a.key);
        continue;
      }
      if (!old) {
        if (!a.stale) d.newAssignments.push(a.key);
        continue;
      }
      const changes = [];
      for (const [field, label] of ASSIGNMENT_FIELDS) {
        const before = old[field] ?? '';
        const after = a[field] ?? '';
        if (before !== after) changes.push({ field, label, before, after });
      }
      if (changes.length) d.changedAssignments.push({ key: a.key, changes });
    }

    if (prev) {
      // Only report removals for classes we actually loaded this time.
      const loaded = new Set(child.enrollments.filter((e) => e.ok?.assignments).map((e) => e.id));
      for (const old of Object.values(prev.assignments)) {
        if (!child.assignments[old.key] && loaded.has(old.enrollmentId)) d.removedAssignments.push(old);
      }
    }

    for (const f of Object.values(child.feedback)) {
      if (prev ? !prev.feedback?.[f.id] && !f.stale : recent(f.ts, cutoff)) d.newFeedback.push(f.id);
    }

    for (const u of Object.values(child.updates)) {
      if (prev ? !prev.updates?.[u.key] : recent(u.date, cutoff)) d.newUpdates.push(u.key);
    }

    d.total = d.newAssignments.length + d.changedAssignments.length + d.removedAssignments.length + d.newFeedback.length + d.newUpdates.length;
    out.children[child.id] = d;
    out.total += d.total;
  }

  const hadMessages = baseline && Object.keys(baseline.messages || {}).length > 0;
  for (const m of Object.values(latest?.messages || {})) {
    if (hadMessages ? !baseline.messages[m.id] : recent(m.date, cutoff)) out.newMessages.push(m.id);
  }
  out.total += out.newMessages.length;
  return out;
}
