# Releasing the Safari version (TestFlight)

The Safari extension ships inside a small app, **Parent Digest**, for iPhone, iPad and Mac. Both platforms share one bundle ID (`com.jeffreywescott.Parent-Digest`), so they're one app in App Store Connect with an iOS build and a macOS build.

Distribution starts with **TestFlight**: a public link that anyone can use to install it, after a light Beta App Review. TestFlight builds expire after 90 days, so upload a new build at least every three months. Moving to the App Store later reuses everything below.

## 0. One-time local setup

Create `safari/Config/Local.xcconfig` (git-ignored) with your team ID:

```
DEVELOPMENT_TEAM = ABCDE12345
```

Your team ID is shown at developer.apple.com → Account → Membership details.

## 1. Create the app in App Store Connect

App Store Connect → **Apps** → **+** → **New App**:

| Field | Value |
|---|---|
| Platforms | iOS **and** macOS |
| Name | `Parent Digest` (must be unique on the App Store; if it's taken, try `Parent Digest – School Updates`) |
| Primary language | English (U.S.) |
| Bundle ID | `com.jeffreywescott.Parent-Digest`. If it isn't in the list yet, archive once (step 2) so Xcode registers it, then come back. |
| SKU | `parent-digest` |
| User access | Full Access |

## 2. Upload a build (repeat for each platform)

1. `npm run safari` opens the Xcode project.
2. Choose the scheme and destination:
   - iPhone/iPad: **Parent Digest (iOS)** + **Any iOS Device (arm64)**
   - Mac: **Parent Digest (macOS)** + **Any Mac**
3. **Product → Archive.**
4. In the Organizer window that opens: **Distribute App → App Store Connect → Distribute**. Keep the defaults, including automatic signing.

Each upload needs a higher build number than the last one for that platform. Bump **Build** (`CURRENT_PROJECT_VERSION`) in the target's **General** tab, or run `agvtool next-version -all` in `safari/Parent Digest`. **Version** (`MARKETING_VERSION`) stays at 1.0 until a release worth a new number.

Export compliance is already answered in the app (`ITSAppUsesNonExemptEncryption = NO`), so builds don't wait on that question.

After a few minutes, the builds appear under **TestFlight** (iOS builds and macOS builds are listed separately).

## 3. TestFlight → Test Information

**Beta App Description:**

```
Parent Digest shows what changed in your school's Veracross parent portal — new and changed assignments, teacher feedback word for word, attendance, class posts and school messages — in one Safari page with an "Action items" tab and a feed per child. It uses the login you already have in Safari, never sees your password, and keeps everything on your device.
```

**Feedback Email:** your publisher contact email

**Marketing URL:** `https://github.com/jeffreywescott/veracross-browser-extension`

**Privacy Policy URL:** `https://github.com/jeffreywescott/veracross-browser-extension/blob/main/PRIVACY.md`

**Beta App Review Information:**
- **Sign-in required:** No. The reviewer uses the built-in sample data (see the notes).
- **Contact:** your name, email and phone.
- **Review notes:**

```
Parent Digest is a Safari Web Extension for parents whose school uses the Veracross parent portal. Real use requires a parent account at a Veracross school, which we can't provide (accounts are issued by schools to families).

To review without an account, use the built-in sample data:
1. Install and open Parent Digest once, then open Safari.
2. iOS: open any website, tap the page menu at the left of the address bar → Manage Extensions → turn on Parent Digest.
   macOS: Safari → Settings → Extensions → enable Parent Digest.
3. Open the extension: on iOS tap Parent Digest in the page menu, on macOS click its toolbar button. The digest page opens.
4. Tap "Try it with sample data". The full interface loads with made-up children, assignments, teacher feedback, attendance and school messages. Nothing is read from any server and nothing is saved.

Privacy: all data stays on the device (browser extension storage). There is no server, no analytics, no tracking and no account. The extension only contacts the Veracross portal sites listed in its manifest.
```

## 4. Share it

1. **TestFlight → External Testing → +** → create a group, e.g. `Parents`.
2. Add the iOS build and the macOS build to the group, and fill in **What to Test**:
   ```
   First release. Please check that your children's names, classes, assignments and teacher feedback appear correctly after Refresh, and send feedback if anything looks wrong or is missing (open the dashboard's Diagnostics section and include what it shows).
   ```
3. **Submit for Review** (Beta App Review, usually a day or two).
4. Once it's approved, turn on **Public Link** in the group and share the link.

Parents install the free **TestFlight** app, open the link, and install Parent Digest. Then they turn it on in Safari as described in the app.

## Later: App Store

This needs screenshots (iPhone 6.9", iPad 13", Mac 16:10), a subtitle (e.g. `For Veracross parent portals`), keywords, an age rating, and the **App Privacy** questionnaire. Answer **Data Not Collected**: Apple counts data as "collected" only when it's sent off the device, which this extension never does. That's different from Google's Chrome Web Store form, which counts local handling too.
