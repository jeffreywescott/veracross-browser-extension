# Parent Digest for Veracross

A browser extension for Chrome and Safari. It reads the Veracross parent portal with the session you're already logged in with, and shows:

- **Action items.** What needs attention, everything new or changed since you last marked things seen, what's due in the next few days, and past-due items still marked *Pending*.
- **One feed per child**, newest first. It covers assignments (new, changed with before → after, or removed), teacher feedback (word for word), attendance, class posts and school messages.

No passwords, no server, and no data leaves the browser.

## Privacy

- The extension only talks to `portals.veracross.com`, `portals-embed.veracross.com` and `classes.veracross.com`. The manifest's `connect-src` enforces this, and so does a host allowlist in `src/lib/fetcher.js`.
- It uses your existing login. It never asks for, sees or stores a password. If your session has expired, it tells you to log in to the portal yourself.
- Everything it keeps is in `chrome.storage.local` on your computer: the latest snapshot, the snapshot you last marked as seen, and the last 12 digests. There are no analytics, no remote logging and no sync. You can delete it all with **Settings → Delete all stored data**.
- Translation is optional and uses the browser's built-in **on-device** Translator API (Chrome 138+). Text is never sent to a translation service. The original always stays on screen and is the authoritative version.
- Requests are sequential with a 300 ms gap, and only happen when you press Refresh, or on the optional daily or weekly check. A refresh for two children is roughly 2 × (number of classes) JSON calls plus a few pages.

**Caveat:** this uses undocumented portal endpoints, not the official Veracross API. They can change without notice, and automated access may conflict with Veracross's terms of use. Keep refreshes infrequent.

## Install

### Chrome (or Edge, Brave, Arc)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Log in to your Veracross parent portal, then click the extension's toolbar icon **on a portal page**. That's how it learns your school route, e.g. `ebgis`. You can also type the route in Settings.
4. Press **Refresh**.

### Safari (macOS)

```bash
npm run safari
```

This wraps the extension in an Xcode project under `dist/safari`. Open it in Xcode and run the macOS app once. Then, in Safari:

1. Turn on **Settings → Advanced → Show features for web developers**.
2. Choose **Develop → Allow Unsigned Extensions**. This resets every time Safari quits.
3. Enable **Parent Digest** under **Settings → Extensions**, and allow it on the three Veracross sites.

Safari differences: there's no background schedule (Safari has no offscreen API), so you refresh by hand. If Safari keeps cookies away from extension requests, the extension runs each request inside a Veracross tab instead (see *How it works*).

## Using it

- **Refresh** reads everything. The first run takes about a minute.
- **NEW / CHANGED / REMOVED** badges compare the latest data with what you last **marked as seen**. Refreshing again doesn't clear them; only *Mark all as seen* does. That also saves the digest to **History**.
- **First run:** nothing has been "seen" yet, so only items from the last 14 days are marked new. You can change this in Settings.
- **Coming up** lists everything due in the next 7 days (3, 7 or 14 in Settings), changed or not. It's labelled as context so it isn't mistaken for a change.
- **Needs attention** is chosen by simple rules: new attendance entries, due-date changes, and posts or messages whose text looks like a deadline ("waiver … by Thursday", "RSVP", "bis Freitag" and similar). It's a hint, not a guarantee, so each card links to the original.
- **Automatic check** (Chrome only, off by default): runs daily or weekly while Chrome is open. It sets a badge count and can show a notification. It needs your Veracross session to still be valid.

## How it works

| Step | Source | Code |
|---|---|---|
| Children | `portals.veracross.com/{school}/parent` (HTML): links to `/parent/student/{id}/overview`, named by the nearest heading | `parseChildren` |
| Classes | `…/student/{id}/overview` (HTML): `/classes/{enrollmentId}/assignments` links, names from the nearest `classes.veracross.com/…/course/{id}/website` link (DOM proximity first, page order only as a flagged fallback) | `parseEnrollments` |
| Assignments | `portals-embed…/parent/enrollment/{id}/assignments` (JSON) | `normalizeAssignment` |
| Feedback | `portals-embed…/parent/enrollment/{id}/feedback` (JSON). `feedback_date` has no year, so it is inferred as the most recent past date | `normalizeFeedback`, `parseFeedbackDate` |
| Attendance, posts | `…/student/{id}/recent-updates` (HTML): entries under date headings | `parseRecentUpdates` |
| Post text | `classes.veracross.com/…/posts/{n}`. These pages render client-side, so they're loaded briefly in a background tab and read with `innerText`. Only new posts, at most 8 per refresh | `Fetcher.renderedText` |
| Messages | `…/parent/messages` and `…/parent/detail/email/{id}` (HTML). Bodies are read once and kept; the "Upcoming Events Overview" section is pulled out | `parseMessageList`, `parseMessageDetail` |

**Fetching** (`src/lib/fetcher.js`) is decided per host:

1. **Direct.** `fetch(url, { credentials: 'include' })` from the extension page. In Chrome, extension requests to hosts listed in `host_permissions` carry that site's cookies.
2. **In-tab fallback.** If the direct response looks like a login page, the extension runs the same `fetch` inside a tab on that host with `scripting.executeScript`. That makes it a same-origin request with the page's cookies. It reuses an open portal tab if there is one; otherwise it opens a background tab and closes it afterwards.
3. If both come back as a login page, the refresh stops and shows **Please log in to Veracross**. It never tries to log in for you.

**Change tracking** (`src/lib/diff.js`) keys each item as follows:

- assignments by `enrollmentId:assignment_id`
- feedback by `feedback_id`
- recent updates by a hash of date, type and text
- messages by `messageId`

For assignments it compares due date, status, score, title, type and notes. If a class fails to load, the last known data is kept and marked *not refreshed*, and removals aren't reported for it. That way a network hiccup never looks like assignments vanished.

## Decisions on the brief's open questions

- **Triggers:** manual refresh from a full-page dashboard, plus an optional daily or weekly check in Chrome. The check runs in an offscreen document because service workers have no `DOMParser`.
- **Translation:** English is offered only when a note looks non-English and the on-device API exists. Nothing is ever translated automatically, and the original is never replaced.
- **First run:** the last 14 days are marked new (configurable, including "everything").
- **Distribution:** share it privately with EBGIS parents as an unpacked extension or zip (`npm run zip`) before any store listing. The Chrome Web Store would need a privacy policy, and should wait until it has been tested at a second school.

## Needs checking against the real portal

The parsers were written from the brief and tested against synthetic HTML in `test/fixtures/`, not real portal pages. After your first real refresh, open **Diagnostics** at the bottom of the dashboard. It shows, per child, how many classes, assignments, feedback entries and updates were found, plus every warning. Things most likely to need tuning:

- **Recent updates.** The markup is unknown, so the parser looks for type labels ("DAILY ATTENDANCE", "NEW POST", …) under date headings. If Diagnostics shows 0 updates, save that page's HTML into `test/fixtures/` (strip names first) and adjust `parseRecentUpdates`.
- **Children's names and class names.** If a tab says "Student 1234", or a class shows as "Class 5678" or is flagged "matched by page order", adjust `parseChildren` or `parseEnrollments`.
- **Message bodies.** If a body in the dashboard is empty or mostly navigation, adjust the selector in `parseMessageDetail`.
- **Safari cookies.** Check whether direct requests work or whether it falls back to in-tab requests. The mode used is listed under Diagnostics as "fetch mode".

## Development

```bash
npm install     # linkedom, for parser tests only
npm test        # node --test
npm run icons   # regenerate icons/ (needs Pillow)
npm run zip     # dist/parent-digest.zip for sharing
```

After changing code, reload the extension at `chrome://extensions` (or remove it and load it unpacked again), then reload the dashboard tab. Reloading the tab alone can keep running the old code.

To work on the UI without a Veracross login, serve the repo and open `src/pages/dashboard.html`, e.g. with `python3 -m http.server`. Outside the extension it loads made-up demo data from `src/pages/demo.js`.

```
manifest.json
src/background.js          toolbar click, school detection, alarms, notifications (no imports, for Safari)
src/pages/dashboard.*      the digest page
src/pages/offscreen.*      scheduled checks (Chrome)
src/pages/demo.js          fake data for UI work
src/lib/config.js          hosts, URLs, default settings
src/lib/fetcher.js         throttled requests, direct/in-tab strategies, session detection
src/lib/parse.js           HTML parsers
src/lib/normalize.js       JSON → stored records
src/lib/collect.js         builds a snapshot
src/lib/diff.js            snapshot vs baseline
src/lib/feed.js            view model: feeds and action items
src/lib/store.js           storage.local wrapper
src/lib/dates.js, text.js  parsing helpers, deadline detection
src/lib/translate.js       optional on-device translation
```
