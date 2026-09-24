// All network access goes through here. Requests are sequential with a small delay, and only
// ever go to the three Veracross hosts (also enforced by the manifest's connect-src).
//
// Two strategies, chosen per host:
//  - direct: fetch() from the extension page with credentials. Works in Chrome, where extension
//    requests to hosts in host_permissions carry the site's cookies.
//  - tab:    run the same fetch() inside a tab on that host via scripting.executeScript, so it is a
//    same-origin request with the page's cookies. Fallback for browsers (Safari) or cookie settings
//    that keep cookies away from extension requests.
// If both come back as a login page, the session has expired and we stop.

import { ext } from './ext.js';
import { HOSTS } from './config.js';
import { looksLikeLoginPage } from './parse.js';

export class SessionExpiredError extends Error {
  constructor(msg = 'Your Veracross session has expired. Log in to the portal, then refresh.') {
    super(msg);
    this.name = 'SessionExpiredError';
  }
}

const ALLOWED = new Set(Object.values(HOSTS));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isLoginResponse(res, requestedUrl, wantJson) {
  if (res.status === 401 || res.status === 403) return true;
  if (res.status === 404 || res.status >= 500) return false; // real errors, reported by checkStatus
  let finalUrl;
  try { finalUrl = new URL(res.url || requestedUrl); } catch { return false; }
  const req = new URL(requestedUrl);
  if (finalUrl.host !== req.host && !ALLOWED.has(finalUrl.host)) return true;
  if (/\/(login|log_in|sign_in|signin|session|sso|saml|auth)(\/|$|\?)/i.test(finalUrl.pathname)) return true;
  if (wantJson) {
    const t = res.text.trimStart();
    return !(res.contentType.includes('json') || t.startsWith('{') || t.startsWith('['));
  }
  return looksLikeLoginPage(res.text);
}

// Runs inside a Veracross tab (serialized by executeScript; must be self-contained).
async function inPageFetch(url, accept) {
  const res = await fetch(url, { credentials: 'include', headers: { Accept: accept }, redirect: 'follow' });
  return { status: res.status, url: res.url, contentType: res.headers.get('content-type') || '', text: await res.text() };
}

function inPageText() {
  return { text: document.body ? document.body.innerText : '', title: document.title, url: location.href };
}

export class Fetcher {
  constructor({ delayMs = 300, allowTabs = true, onRequest = () => {} } = {}) {
    this.delayMs = delayMs;
    this.allowTabs = allowTabs && !!(ext?.tabs && ext?.scripting);
    this.onRequest = onRequest;
    this.mode = new Map(); // host -> 'direct' | 'tab'
    this.tabs = new Map(); // host -> { tabId, created }
    this.last = 0;
    this.count = 0;
  }

  async throttle() {
    const wait = this.last + this.delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.last = Date.now();
  }

  async getJSON(url) {
    const res = await this.request(url, 'application/json', true);
    try {
      return JSON.parse(res.text);
    } catch {
      throw new Error(`Expected JSON from ${new URL(url).pathname}`);
    }
  }

  async getHTML(url) {
    const res = await this.request(url, 'text/html,application/xhtml+xml', false);
    return { html: res.text, url: res.url || url };
  }

  async request(url, accept, wantJson) {
    const host = new URL(url).host;
    if (!ALLOWED.has(host)) throw new Error(`Refusing to fetch non-Veracross host ${host}`);

    let res = null;
    if (this.mode.get(host) !== 'tab') {
      await this.throttle();
      this.onRequest(url);
      this.count++;
      try {
        const r = await fetch(url, { credentials: 'include', headers: { Accept: accept }, redirect: 'follow' });
        res = { status: r.status, url: r.url, contentType: r.headers.get('content-type') || '', text: await r.text() };
      } catch (e) {
        res = null; // network/CORS failure: try the tab strategy
      }
      if (res && !isLoginResponse(res, url, wantJson)) {
        this.mode.set(host, 'direct');
        return this.checkStatus(res, url);
      }
      // Direct worked earlier for this host, so a login response now means the session really expired.
      if (this.mode.get(host) === 'direct' || !this.allowTabs) {
        if (res) throw new SessionExpiredError();
        throw new Error(`Could not reach ${host}`);
      }
      this.mode.set(host, 'tab');
    }

    await this.throttle();
    this.onRequest(url);
    this.count++;
    const tabId = await this.tabFor(host, url);
    const [inj] = await ext.scripting.executeScript({ target: { tabId }, func: inPageFetch, args: [url, accept] });
    if (!inj || !inj.result) throw new Error(`In-page request failed for ${new URL(url).pathname}`);
    res = inj.result;
    if (isLoginResponse(res, url, wantJson)) throw new SessionExpiredError();
    return this.checkStatus(res, url);
  }

  checkStatus(res, url) {
    if (res.status >= 400) {
      const err = new Error(`HTTP ${res.status} for ${new URL(url).pathname}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  // Finds an open tab on `host`, or opens a background one. Tabs we open are closed in close().
  async tabFor(host, url) {
    const known = this.tabs.get(host);
    if (known) {
      try {
        const t = await ext.tabs.get(known.tabId);
        if (t && new URL(t.url || 'about:blank').host === host) return known.tabId;
      } catch { /* closed by the user */ }
      this.tabs.delete(host);
    }
    const open = await ext.tabs.query({ url: `https://${host}/*` });
    const ready = open.find((t) => t.status === 'complete') || open[0];
    if (ready) {
      this.tabs.set(host, { tabId: ready.id, created: false });
      await waitForTab(ready.id);
      return ready.id;
    }
    const t = await ext.tabs.create({ url, active: false });
    this.tabs.set(host, { tabId: t.id, created: true });
    const loaded = await waitForTab(t.id);
    if (!loaded || new URL(loaded.url || 'about:blank').host !== host) throw new SessionExpiredError();
    return t.id;
  }

  // Loads a client-rendered page (class posts) in a background tab and returns its visible text.
  async renderedText(url, { timeoutMs = 12000 } = {}) {
    if (!this.allowTabs) throw new Error('Reading class posts needs the tabs/scripting APIs.');
    const host = new URL(url).host;
    if (!ALLOWED.has(host)) throw new Error(`Refusing to open non-Veracross host ${host}`);
    await this.throttle();
    this.onRequest(url);
    this.count++;

    let entry = this.tabs.get(`render:${host}`);
    if (entry) {
      try { await ext.tabs.update(entry.tabId, { url }); } catch { entry = null; }
    }
    if (!entry) {
      const t = await ext.tabs.create({ url, active: false });
      entry = { tabId: t.id, created: true };
      this.tabs.set(`render:${host}`, entry);
    }
    // Give the update a moment to begin navigating before waiting on 'complete'.
    await sleep(150);
    const tab = await waitForTab(entry.tabId, timeoutMs);
    if (!tab || new URL(tab.url || 'about:blank').host !== host) throw new SessionExpiredError();

    // Client-side rendering: poll until the text stops growing.
    const deadline = Date.now() + timeoutMs;
    let prev = -1;
    let result = null;
    while (Date.now() < deadline) {
      const [inj] = await ext.scripting.executeScript({ target: { tabId: entry.tabId }, func: inPageText });
      result = inj?.result;
      const len = result?.text?.length ?? 0;
      if (len > 200 && len === prev) break;
      prev = len;
      await sleep(700);
    }
    return result;
  }

  async close() {
    for (const { tabId, created } of this.tabs.values()) {
      if (created) {
        try { await ext.tabs.remove(tabId); } catch { /* already closed */ }
      }
    }
    this.tabs.clear();
  }

  describe() {
    return Object.fromEntries(this.mode);
  }
}

async function waitForTab(tabId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let t;
    try { t = await ext.tabs.get(tabId); } catch { return null; }
    if (t.status === 'complete' && t.url && t.url !== 'about:blank') return t;
    await sleep(250);
  }
  try { return await ext.tabs.get(tabId); } catch { return null; }
}
