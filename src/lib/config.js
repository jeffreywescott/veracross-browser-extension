export const HOSTS = {
  portal: 'portals.veracross.com',
  embed: 'portals-embed.veracross.com',
  classes: 'classes.veracross.com',
};

export const DEFAULT_SETTINGS = {
  school: '',
  // "Coming up" window on the Action items tab.
  dueSoonDays: 7,
  // On the very first refresh (no baseline yet), only items this recent are marked NEW.
  firstRunLookbackDays: 14,
  // 'off' | 'daily' | 'weekly'. Chrome only (needs the offscreen API for DOM parsing).
  schedule: 'off',
  notify: true,
  // Class posts render client-side, so reading them means briefly loading the page in a background tab.
  fetchPostText: true,
  maxPostFetchesPerRefresh: 8,
  maxMessageFetchesPerRefresh: 10,
  requestDelayMs: 300,
  // Recent updates and messages only show a window; keep what we've seen for this long.
  retainDays: 180,
};

const SCHOOL_BLOCKLIST = new Set(['login', 'logout', 'auth', 'sso', 'assets', 'api', 'static']);

export function schoolFromUrl(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (!Object.values(HOSTS).includes(u.host)) return null;
  const seg = u.pathname.split('/').filter(Boolean)[0];
  if (!seg || SCHOOL_BLOCKLIST.has(seg.toLowerCase()) || !/^[a-z0-9_-]+$/i.test(seg)) return null;
  return seg;
}

export const urls = {
  parentHome: (s) => `https://${HOSTS.portal}/${s}/parent`,
  overview: (s, sid) => `https://${HOSTS.portal}/${s}/parent/student/${sid}/overview`,
  recentUpdates: (s, sid) => `https://${HOSTS.portal}/${s}/parent/student/${sid}/recent-updates`,
  classAssignmentsPage: (s, sid, eid) => `https://${HOSTS.portal}/${s}/parent/student/${sid}/classes/${eid}/assignments`,
  messages: (s) => `https://${HOSTS.portal}/${s}/parent/messages`,
  messageDetail: (s, mid) => `https://${HOSTS.portal}/${s}/parent/detail/email/${mid}`,
  assignmentsJson: (s, eid) => `https://${HOSTS.embed}/${s}/parent/enrollment/${eid}/assignments`,
  feedbackJson: (s, eid) => `https://${HOSTS.embed}/${s}/parent/enrollment/${eid}/feedback`,
};
