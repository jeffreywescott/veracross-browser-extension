// Everything lives in storage.local on this device. Nothing is synced or sent anywhere.

import { ext, inExtension } from './ext.js';
import { DEFAULT_SETTINGS } from './config.js';

const HISTORY_LIMIT = 12;

// Offscreen documents only get chrome.runtime, so they reach storage through the background worker.
const proxied = (op) => async (...args) => {
  const res = await ext.runtime.sendMessage({ target: 'background-storage', op, args });
  if (!res?.ok) throw new Error(res?.error || 'Storage unavailable');
  return res.result;
};

// In-memory stand-in so the dashboard can run outside the extension (demo / design work).
const memory = new Map();
const area = !inExtension
  ? {
      async get(keys) {
        const list = keys == null ? [...memory.keys()] : Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => memory.has(k)).map((k) => [k, structuredClone(memory.get(k))]));
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) memory.set(k, structuredClone(v)); },
      async remove(keys) { for (const k of [].concat(keys)) memory.delete(k); },
      async clear() { memory.clear(); },
    }
  : ext.storage?.local ?? { get: proxied('get'), set: proxied('set'), remove: proxied('remove'), clear: proxied('clear') };

const k = {
  latest: (s) => `latest:${s}`,
  baseline: (s) => `baseline:${s}`,
  history: (s) => `history:${s}`,
  status: (s) => `status:${s}`,
};

export async function getSettings() {
  const { settings } = await area.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await area.set({ settings: next });
  return next;
}

export async function loadState(school) {
  const got = await area.get([k.latest(school), k.baseline(school), k.history(school), k.status(school)]);
  return {
    latest: got[k.latest(school)] || null,
    baseline: got[k.baseline(school)] || null,
    history: got[k.history(school)] || [],
    status: got[k.status(school)] || {},
  };
}

export async function saveLatest(school, snapshot) {
  await area.set({ [k.latest(school)]: snapshot });
}

export async function saveStatus(school, patch) {
  const cur = (await area.get(k.status(school)))[k.status(school)] || {};
  await area.set({ [k.status(school)]: { ...cur, ...patch } });
}

// "Mark as seen": the latest snapshot becomes the new baseline, and the digest being dismissed
// is kept in a short history.
export async function markSeen(school, digestEntry) {
  const { latest, history } = await loadState(school);
  if (!latest) return;
  const next = digestEntry ? [digestEntry, ...history].slice(0, HISTORY_LIMIT) : history;
  await area.set({ [k.baseline(school)]: latest, [k.history(school)]: next });
}

export async function clearSchool(school) {
  await area.remove([k.latest(school), k.baseline(school), k.history(school), k.status(school)]);
}

export async function clearAll() {
  await area.clear();
}

export async function bytesInUse() {
  try { return await ext.storage.local.getBytesInUse(null); } catch { return null; }
}

export { area as _area };
