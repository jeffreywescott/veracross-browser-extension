# Chrome Web Store listing

Copy these into the Developer Dashboard. Fields are in the order the dashboard shows them.

## Package

Upload `dist/parent-digest.zip`, built by `npm run zip`.

## Store listing tab

**Description:**

```
See what changed in your school's Veracross parent portal at a glance, without clicking through every class.

Parent Digest for Veracross gives you:
• Action items: new attendance entries, changed due dates, and class posts or school messages that mention deadlines ("waiver needed by Thursday", "RSVP by Friday").
• A feed for each child: new, changed and removed assignments (with before → after), teacher feedback shown word for word, attendance, class posts and school messages.
• What's due in the next few days.
• "Mark all as seen", so next time you only see what's new.

Private by design:
• Works with the Veracross login you already have. It never asks for or stores your password.
• Everything stays in your browser. No server, no analytics, no tracking.
• Only talks to Veracross.

How to use: log in to your Veracross parent portal, click the Parent Digest icon while on a portal page, then press Refresh.

Not affiliated with or endorsed by Veracross. It reads the parent portal the same way your browser does, so a change to the portal can break it until the extension is updated.

Source code: https://github.com/jeffreywescott/veracross-browser-extension
```

**Category:** Education (Productivity also fits)

**Language:** English

**Screenshots (1280×800):** `store/screenshot-actions.png`, `store/screenshot-feed.png`. Both use made-up demo data.

**Store icon (128×128):** `icons/icon-128.png`

**Homepage URL:** https://github.com/jeffreywescott/veracross-browser-extension

**Support URL:** https://github.com/jeffreywescott/veracross-browser-extension/issues

## Privacy tab

**Single purpose:**

```
Shows a parent a digest of what changed in their school's Veracross parent portal (assignments, teacher feedback, attendance, class posts and school messages), using their existing login.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Saves the latest portal data, the version the parent last marked as seen (to work out what's new), a short digest history and settings, locally on the device. |
| `unlimitedStorage` | A school year of assignments, feedback and newsletters for several children can exceed the default local storage quota. Data stays on the device. |
| `alarms` | Runs the optional daily or weekly check the parent can turn on in Settings. Off by default. |
| `offscreen` | The optional automatic check needs to parse portal HTML pages, and service workers have no DOMParser. An offscreen document is used only for that. |
| `notifications` | Tells the parent after an optional automatic check that there are new items. Only if they turned it on. |
| `scripting` | If the browser doesn't send the parent's Veracross login cookies with the extension's own requests, the same request is run inside a Veracross tab. Class posts load their content with JavaScript, so new posts are briefly opened in a background tab to read their text. Only used on the three Veracross sites. |
| Host permissions (`portals.veracross.com`, `portals-embed.veracross.com`, `classes.veracross.com`) | These are the Veracross parent portal sites the digest is built from. The extension accesses no other sites. |

**Are you using remote code?** No. All code is in the package.

**Data usage:** the extension processes the following on the device only. Nothing is transmitted to the developer or any third party. Declaring these is the conservative choice:
- [x] Personally identifiable information (children's names)
- [x] Personal communications (school messages, teacher feedback)
- [x] Website content (portal pages it reads)
- everything else unchecked

**Certify:**
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/jeffreywescott/veracross-browser-extension/blob/main/PRIVACY.md

## Distribution tab

**Visibility:** Unlisted. Anyone with the link can install it, but it doesn't show up in search.

**Regions:** all, or just United States.
