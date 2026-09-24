// Runs a refresh for the scheduled check. Offscreen documents can't use the tabs/scripting APIs,
// so this only uses direct requests; if those don't carry the session, the user is asked to
// open the dashboard and refresh by hand.

import { ext } from '../lib/ext.js';
import { getSettings } from '../lib/store.js';
import { runRefresh } from '../lib/refresh.js';
import { SessionExpiredError } from '../lib/fetcher.js';

ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'refresh') return false;
  (async () => {
    const settings = await getSettings();
    try {
      // Post text needs background tabs, which aren't available here; the next manual refresh reads them.
      const { diff } = await runRefresh({ school: settings.school, settings: { ...settings, fetchPostText: false }, allowTabs: false });
      sendResponse({ ok: true, total: diff.total });
    } catch (e) {
      sendResponse({ ok: false, session: e instanceof SessionExpiredError, error: e.message });
    }
  })();
  return true;
});
