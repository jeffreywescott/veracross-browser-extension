import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMDY, parseFeedbackDate, parseLooseDate, toISODate, inferYear } from '../src/lib/dates.js';

const now = new Date(2026, 8, 23, 10, 0); // Sep 23 2026

test('parseMDY', () => {
  assert.equal(toISODate(parseMDY('09/22/2026')), '2026-09-22');
  assert.equal(parseMDY('13/40/2026'), null);
  assert.equal(parseMDY(''), null);
});

test('feedback dates have no year and a one-letter meridiem', () => {
  const d = parseFeedbackDate('Sep 20 @ 9:28 P', now);
  assert.equal(toISODate(d), '2026-09-20');
  assert.equal(d.getHours(), 21);
  assert.equal(d.getMinutes(), 28);
  assert.equal(parseFeedbackDate('Sep 20 @ 12:05 A', now).getHours(), 0);
  assert.equal(parseFeedbackDate('Sep 20 @ 12:05 P', now).getHours(), 12);
});

test('year inference leans to the past', () => {
  // In early January, a "Dec 18" feedback date is last year.
  const jan = new Date(2027, 0, 5);
  assert.equal(toISODate(parseFeedbackDate('Dec 18 @ 3:00 P', jan)), '2026-12-18');
  // In late December, "Jan 3" is most likely next week (within tolerance) — still inside 45 days.
  assert.equal(toISODate(inferYear(0, 3, new Date(2026, 11, 28))), '2027-01-03');
});

test('loose dates', () => {
  assert.equal(toISODate(parseLooseDate('Tuesday, September 22', now)), '2026-09-22');
  assert.equal(toISODate(parseLooseDate('Monday, September 21, 2026', now)), '2026-09-21');
  assert.equal(toISODate(parseLooseDate('Today', now)), '2026-09-23');
  assert.equal(toISODate(parseLooseDate('Yesterday', now)), '2026-09-22');
  assert.equal(toISODate(parseLooseDate('9/21/2026', now)), '2026-09-21');
  assert.equal(toISODate(parseLooseDate('22. September 2026', now)), '2026-09-22');
  assert.equal(toISODate(parseLooseDate('Sept 3', now)), '2026-09-03');
  assert.equal(parseLooseDate('Absent - Excused', now), null);
  assert.equal(parseLooseDate('Monday', now), null);
});
