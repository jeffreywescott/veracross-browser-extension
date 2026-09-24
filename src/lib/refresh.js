// One refresh: collect a snapshot, store it, and diff it against the baseline.
// Shared by the dashboard (manual) and the offscreen document (scheduled).

import { Fetcher, SessionExpiredError } from './fetcher.js';
import { collectSnapshot } from './collect.js';
import { diffSnapshots } from './diff.js';
import { loadState, saveLatest, saveStatus } from './store.js';

const LOCK_MS = 5 * 60 * 1000;

export async function runRefresh({ school, settings, allowTabs = true, onProgress }) {
  const { latest: previous, baseline, status } = await loadState(school);
  if (status.runningSince && Date.now() - status.runningSince < LOCK_MS) {
    throw new Error('A refresh is already running.');
  }
  await saveStatus(school, { runningSince: Date.now() });

  const fetcher = new Fetcher({ delayMs: settings.requestDelayMs, allowTabs });
  try {
    const snapshot = await collectSnapshot({ school, fetcher, previous, settings, onProgress });
    await saveLatest(school, snapshot);
    const diff = diffSnapshots(baseline, snapshot, { lookbackDays: settings.firstRunLookbackDays });
    await saveStatus(school, { runningSince: null, lastRefresh: snapshot.takenAt, lastError: null, lastErrorKind: null, newCount: diff.total });
    return { snapshot, diff };
  } catch (e) {
    const kind = e instanceof SessionExpiredError ? 'session' : 'error';
    await saveStatus(school, { runningSince: null, lastError: e.message, lastErrorKind: kind, lastErrorAt: Date.now() });
    throw e;
  } finally {
    await fetcher.close();
  }
}
