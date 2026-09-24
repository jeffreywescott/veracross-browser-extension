// Service worker. Kept dependency-free (no ES module imports) for Safari compatibility.
// Responsibilities: open the dashboard, remember the school route, run scheduled checks.

const ext = globalThis.browser ?? globalThis.chrome;
const DASHBOARD = 'src/pages/dashboard.html';
const ALARM = 'digest-check';
const HOSTS = ['portals.veracross.com', 'portals-embed.veracross.com', 'classes.veracross.com'];
const PERIOD_MIN = { daily: 24 * 60, weekly: 7 * 24 * 60 };

function schoolFromUrl(href) {
  try {
    const u = new URL(href);
    if (!HOSTS.includes(u.host)) return null;
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg && /^[a-z0-9_-]+$/i.test(seg) && !['login', 'logout', 'auth', 'sso'].includes(seg.toLowerCase()) ? seg : null;
  } catch {
    return null;
  }
}

async function getSettings() {
  const { settings } = await ext.storage.local.get('settings');
  return settings || {};
}

async function openDashboard(school) {
  const base = ext.runtime.getURL(DASHBOARD);
  const url = school ? `${base}?school=${encodeURIComponent(school)}` : base;
  // Reuse an open dashboard tab when the browser can tell us about it (Chrome 116+).
  if (ext.runtime.getContexts) {
    try {
      const ctx = (await ext.runtime.getContexts({ contextTypes: ['TAB'] })).find((c) => c.documentUrl?.startsWith(base));
      if (ctx && ctx.tabId >= 0) {
        await ext.tabs.update(ctx.tabId, { active: true });
        if (ctx.windowId >= 0) await ext.windows.update(ctx.windowId, { focused: true });
        return;
      }
    } catch { /* fall through */ }
  }
  await ext.tabs.create({ url });
}

ext.action.onClicked.addListener(async (tab) => {
  // Clicking the icon on a Veracross page teaches us the school route.
  const school = tab && tab.url ? schoolFromUrl(tab.url) : null;
  if (school) {
    const settings = await getSettings();
    if (settings.school !== school) await ext.storage.local.set({ settings: { ...settings, school } });
  }
  await openDashboard(school);
});

// --- Scheduled checks (Chrome: offscreen document provides DOMParser) ------------------------

async function syncAlarm() {
  const { schedule = 'off' } = await getSettings();
  const existing = await ext.alarms.get(ALARM);
  const period = PERIOD_MIN[schedule];
  if (!period) {
    if (existing) await ext.alarms.clear(ALARM);
    return;
  }
  if (existing && existing.periodInMinutes === period) return;
  await ext.alarms.create(ALARM, { delayInMinutes: Math.min(60, period), periodInMinutes: period });
}

async function ensureOffscreen() {
  const url = ext.runtime.getURL('src/pages/offscreen.html');
  if (ext.runtime.getContexts) {
    const found = await ext.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (found.length) return;
  }
  await ext.offscreen.createDocument({
    url: 'src/pages/offscreen.html',
    reasons: ['DOM_PARSER'],
    justification: 'Parse Veracross portal pages for the scheduled digest check.',
  });
}

async function scheduledCheck() {
  if (!ext.offscreen) return;
  const settings = await getSettings();
  if (!settings.school) return;
  let result;
  try {
    await ensureOffscreen();
    result = await ext.runtime.sendMessage({ target: 'offscreen', type: 'refresh' });
  } catch (e) {
    result = { ok: false, error: String(e && e.message || e) };
  } finally {
    try { await ext.offscreen.closeDocument(); } catch { /* already closed */ }
  }
  if (!result) return;

  if (result.ok) {
    await ext.action.setBadgeBackgroundColor({ color: '#1f6a58' });
    await ext.action.setBadgeText({ text: result.total ? String(Math.min(result.total, 99)) : '' });
    if (result.total && settings.notify !== false && ext.notifications) {
      ext.notifications.create('digest', {
        type: 'basic',
        iconUrl: ext.runtime.getURL('icons/icon-128.png'),
        title: 'Parent Digest',
        message: `${result.total} new or changed item${result.total === 1 ? '' : 's'} in Veracross.`,
      });
    }
  } else {
    await ext.action.setBadgeBackgroundColor({ color: '#a23b3b' });
    await ext.action.setBadgeText({ text: '!' });
    await ext.action.setTitle({ title: result.session ? 'Parent Digest: please log in to Veracross' : `Parent Digest: last check failed (${result.error})` });
  }
}

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) scheduledCheck();
});

if (ext.notifications) {
  ext.notifications.onClicked.addListener(async (id) => {
    if (id !== 'digest') return;
    ext.notifications.clear(id);
    const { school } = await getSettings();
    openDashboard(school);
  });
}

// Storage access for the offscreen document (see src/lib/store.js).
const STORAGE_OPS = new Set(['get', 'set', 'remove', 'clear']);
ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'background-storage' || sender.id !== ext.runtime.id || !STORAGE_OPS.has(msg.op)) return false;
  ext.storage.local[msg.op](...(msg.args || [])).then(
    (result) => sendResponse({ ok: true, result }),
    (e) => sendResponse({ ok: false, error: String(e && e.message || e) }),
  );
  return true;
});

ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) syncAlarm();
});
ext.runtime.onInstalled.addListener(syncAlarm);
ext.runtime.onStartup.addListener(syncAlarm);
