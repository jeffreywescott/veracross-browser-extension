# Parent Digest for Veracross

A Chrome extension. It reads the Veracross parent portal with the session you're already logged in with, and shows:

- **Action items.** What needs attention, everything new or changed since you last marked things seen, what's due in the next few days, and past-due items still marked *Pending*.
- **One feed per child**, newest first. It covers assignments (new, changed with before → after, or removed), teacher feedback (word for word), attendance, class posts and school messages.

No passwords, no server, and no data leaves the browser.

> **Safari: completely untested so far.** Only Chrome has been used with the real portal. A Safari build can be generated, but it has never been loaded or run in Safari. Don't rely on it.

## Privacy

- The extension only talks to `portals.veracross.com`, `portals-embed.veracross.com` and `classes.veracross.com`. The manifest's `connect-src` enforces this, and so does a host allowlist in `src/lib/fetcher.js`.
- It uses your existing login. It never asks for, sees or stores a password. If your session has expired, it tells you to log in to the portal yourself.
- Everything it keeps is in `chrome.storage.local` on your computer: the latest snapshot, the snapshot you last marked as seen, and the last 12 digests. There are no analytics, no remote logging and no sync. You can delete it all with **Settings → Delete all stored data**.
- Translation is optional and uses the browser's built-in **on-device** Translator API (Chrome 138+). Text is never sent to a translation service. The original always stays on screen and is the authoritative version.
- Requests are sequential with a 300 ms gap, and only happen when you press Refresh, or on the optional daily or weekly check. A refresh for two children is roughly 2 × (number of classes) JSON calls plus a few pages.

**Caveat:** this uses undocumented portal endpoints, not the official Veracross API. They can change without notice, and automated access may conflict with Veracross's terms of use. Keep refreshes infrequent.

## Install (Chrome, Developer mode)

The extension isn't in the Chrome Web Store yet. You install it from a copy of this folder using Chrome's **Developer mode**. This works in Chrome and other Chromium browsers: Edge, Brave, Arc.

### 1. Get the code

The repository is private for now, so you need to have been given access. Then either clone it:

```bash
git clone https://github.com/jeffreywescott/veracross-browser-extension.git
```

or, on the GitHub page, click **Code → Download ZIP** and unzip it. Put the folder somewhere permanent, such as `Documents`. Chrome loads the extension from that folder every time it starts, so it has to stay where it is.

### 2. Load it into Chrome

1. Go to `chrome://extensions` (type it into the address bar).
2. Turn on **Developer mode** with the switch at the top right.
3. Click **Load unpacked**.
4. Choose the folder that contains `manifest.json` (the top level of this repo) and click **Select**.
5. **Veracross Parent Digest** appears in the list. To keep it in the toolbar, click the puzzle-piece icon next to the address bar and pin it.

Chrome may show a banner about developer-mode extensions when it starts. That's normal for extensions installed this way. You can dismiss it.

### 3. First run

1. Log in to your Veracross parent portal as usual, e.g. `https://portals.veracross.com/<school>/parent`.
2. While you're **on a portal page**, click the Parent Digest toolbar icon. That's how it learns your school's route, e.g. `ebgis`. You can also type the route in the dashboard's Settings.
3. On the dashboard that opens, press **Refresh**. The first refresh reads every class for every child and takes about a minute.

### Updating

Get the new code with `git pull`, or download and unzip it into the same folder. Then open `chrome://extensions` and click the **reload** arrow on the Veracross Parent Digest card, and reload any open dashboard tab. Reloading only the dashboard tab can leave Chrome running the old code. If the reload arrow doesn't pick up the change, click **Remove**, then **Load unpacked** again. Your stored data survives a reload, but **Remove** deletes it.

### Uninstalling

Click **Remove** on the Veracross Parent Digest card in `chrome://extensions`. That also deletes everything the extension stored.

### Safari (completely untested)

> **Warning:** nobody has run this extension in Safari yet. It has never been loaded in Safari, never logged in, and never refreshed. Expect it to break, possibly in ways that look like "Please log in to Veracross".

What *has* been checked: `npm run safari` turns the extension into an Xcode project under `dist/safari`, and that project builds. That's all.

Known or likely differences:
- There's no automatic daily or weekly check (Safari lacks the offscreen API), so you'd refresh by hand.
- Safari may not send your Veracross login cookies with the extension's requests. The extension would then fall back to running each request inside a background Veracross tab. That fallback is also untested.
- On-device translation isn't available.

If you want to try it anyway:
1. Run the app from Xcode once.
2. Enable **Develop → Allow Unsigned Extensions**. This resets when Safari quits.
3. Turn on Parent Digest in **Settings → Extensions** and allow it on the three Veracross sites.

Then open **Diagnostics** at the bottom of the dashboard and check the `fetch mode` line.

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

## Portal compatibility

The HTML parsers were checked against the real EBGIS portal in September 2026. The layouts they expect are captured in `test/fixtures/*-ebgis.html`, with made-up names and content. Veracross can change its pages at any time, and other schools may be on different portal versions. If a refresh looks wrong, open **Diagnostics** at the bottom of the dashboard. It shows, per child, how many classes, assignments, feedback entries and updates were found, plus any warnings. Not yet seen live: class post pages on `classes.veracross.com`, and assignments with scores entered.

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
src/background.js          toolbar click, school detection, alarms, notifications (no imports, to keep Safari possible)
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

## License

[MIT](LICENSE) © 2026 Jeffrey Wescott. Not affiliated with or endorsed by Veracross.
