# Polaris — Setup Guide

Polaris is a single-file PWA (`index.html`) plus `manifest.json` and `sw.js`. It works locally with **zero setup** — tasks are saved in your browser's `localStorage`. Everything below is *optional*, and each section is independent:

| Feature | Needed? | Section |
|---|---|---|
| Use Polaris on one device, no login | Works out of the box | — |
| Sync tasks across devices | Firebase | [1](#1-firebase-setup-cloud-sync) |
| See Outlook events, convert to tasks | Azure Entra ID | [2](#2-azure-entra-id-app-registration-microsoft-365-calendar) |
| Real background push reminders | VAPID + a tiny send function | [3](#3-web-push--vapid-keys) |
| Install as an app / host it | GitHub Pages | [4](#4-hosting-on-github-pages) |
| Add to Home Screen | iOS / Android | [5](#5-installing-the-pwa-on-ios--android) |

---

## 0. File overview

```
polaris/
├── index.html         ← the whole app (HTML + CSS + JS)
├── manifest.json       ← PWA install metadata
├── sw.js                ← service worker (offline cache + push)
├── vendor/
│   └── msal-browser.min.js   ← Microsoft's auth library, vendored locally (see §2)
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-192-maskable.png
│   ├── icon-512-maskable.png
│   ├── apple-touch-icon.png
│   └── favicon-64.png
└── SETUP.md
```

Open `index.html` in a browser (or serve the folder — see [Hosting](#4-hosting-on-github-pages)) and it runs immediately in **local-only mode**. The three integrations below just fill in placeholder config values near the top of the `<script type="module">` block in `index.html`:

```js
const FIREBASE_CONFIG = { apiKey: "YOUR_FIREBASE_API_KEY", ... };
const MSAL_CONFIG = { auth: { clientId: "YOUR_AZURE_APP_CLIENT_ID", ... } };
const VAPID_PUBLIC_KEY = "YOUR_VAPID_PUBLIC_KEY";
```

Edit those three spots directly in `index.html` — there's no build step, so a plain text edit is all that's needed.

---

## 1. Firebase setup (cloud sync)

Polaris uses **Firebase Authentication (Anonymous)** + **Firestore** so a person can sync tasks across their own devices using a private "sync code" instead of a traditional email/password login.

### 1.1 Create the project
1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → name it (e.g. `polaris-planner`) → finish the wizard (Google Analytics is optional, skip it).
2. In the left sidebar, click **Build → Authentication → Get started**.
3. Under **Sign-in method**, enable **Anonymous**.
4. In the left sidebar, click **Build → Firestore Database → Create database**.
   - Choose **Start in production mode** (we'll add rules below).
   - Pick the region closest to you.

### 1.2 Get your web app config
1. Click the gear icon → **Project settings**.
2. Scroll to **Your apps** → click the **</>** (web) icon → register an app (nickname: "Polaris").
3. Skip the Firebase Hosting prompt.
4. Copy the `firebaseConfig` object shown — you'll get something like:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "polaris-planner.firebaseapp.com",
  projectId: "polaris-planner",
  storageBucket: "polaris-planner.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};
```

5. Paste those values into `FIREBASE_CONFIG` near the top of the `<script>` block in `index.html`.

### 1.3 Firestore security rules
Anonymous auth means *any* signed-in-anonymously user could read/write *any* sync code's data unless you scope the rules. Since the "shared secret" is the sync code itself (like a long, hard-to-guess room code), the rules below simply require the user to be authenticated — go to **Firestore Database → Rules** and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /syncCodes/{code}/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

> **Note on the sync-code model:** this is intentionally lightweight (no email, no password) to match the "quick entry, zero friction" philosophy. It trades strict per-user access control for simplicity — anyone who has the sync code can read/write that code's tasks. Treat a sync code like a shared house key: convenient, not meant to be posted publicly. For stricter isolation, you could later swap Anonymous Auth for Firebase's Email Link or Google sign-in and key documents by `request.auth.uid` instead of a shared code.

### 1.4 Test it
Reload `index.html`. You should see a **welcome gate** on first load offering to create or join a sync code. Create one, then open the same file on a second device/browser and choose **"I have a code"** — tasks should sync within a couple of seconds. The small text under the Polaris logo (top-left) shows `synced · YOUR-CODE` when connected.

---

## 2. Azure Entra ID app registration (Microsoft 365 calendar)

This lets Polaris show your upcoming Outlook events (read-only) via **MSAL.js** and the **Microsoft Graph API**, entirely client-side — no backend required.

> **About the `vendor/msal-browser.min.js` file:** earlier drafts of this app loaded MSAL from Microsoft's `alcdn.msauth.net` CDN, and some people hit an "MSAL init failed" console error with that approach. That CDN has been **fully deprecated as of MSAL.js v3** and, even for the older v2 builds still technically hosted there, has had reported reliability problems (broken versions, IPv6 access issues). Microsoft's current guidance is to download the library from npm and serve it as a static file alongside your app — so that's exactly what's already done for you here: `vendor/msal-browser.min.js` is the official `@azure/msal-browser@2.38.3` build, vendored locally. You don't need to do anything extra for this part; it's already in the deliverables and gets deployed alongside `index.html` like any other file. If you ever want to upgrade it, download a newer `lib/msal-browser.min.js` from the [npm package](https://www.npmjs.com/package/@azure/msal-browser?activeTab=versions) (stick to a 2.x version — the file format changes in 3.x) and replace the file in `vendor/`.

### 2.1 Register the app
1. Go to [entra.microsoft.com](https://entra.microsoft.com) (or the Azure Portal → **Microsoft Entra ID**) → **App registrations** → **New registration**.
2. Name: `Polaris`.
3. **Supported account types:** choose "Accounts in any organizational directory and personal Microsoft accounts" if you want personal Outlook.com calendars to work too; otherwise pick your org's option.
4. **Redirect URI:** platform = **Single-page application (SPA)**, value = the exact URL Polaris will be served from, e.g.:
   - `http://localhost:5500/index.html` (local testing)
   - `https://yourusername.github.io/polaris/index.html` (GitHub Pages)
5. Click **Register**.

### 2.2 Configure API permissions
1. In your new app → **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**.
2. Add:
   - `User.Read`
   - `Calendars.Read`
3. Click **Grant admin consent** if you're in an org that requires it (personal/consumer accounts don't need this step).

### 2.3 Copy the Client ID
1. Go to **Overview** → copy the **Application (client) ID**.
2. Paste it into `MSAL_CONFIG.auth.clientId` in `index.html`:

```js
const MSAL_CONFIG = {
  auth: {
    clientId: "PASTE-YOUR-CLIENT-ID-HERE",
    authority: "https://login.microsoftonline.com/common",
    redirectUri: window.location.origin + window.location.pathname
  },
  cache: { cacheLocation: "localStorage" }
};
```

`redirectUri` is computed automatically from the page's own URL, so it always matches what you registered in step 2.1 — just make sure the **Redirect URI in Azure exactly matches** the URL Polaris is hosted at (including trailing `index.html`, and `http` vs `https`).

### 2.4 Use it
In Polaris, open **Settings → Microsoft 365 calendar → Connect** (or the **Calendar** tab, which prompts the same flow). A Microsoft popup will ask you to sign in and consent. Once connected, upcoming events appear in the **Calendar** view, each with a **+** button that opens the task modal with the title, date, and time pre-filled.

> MSAL is loaded lazily from `https://alcdn.msauth.net` only if you've filled in a real client ID, so leaving the placeholder in place has zero effect on the rest of the app.

---

## 3. Web push / VAPID keys

Polaris's service worker (`sw.js`) is fully wired to **receive and display** push notifications, and the app requests notification permission and creates a `PushSubscription` in the browser. What's *not* included, because it requires a server, is the piece that actually **sends** a push message at the right time.

Here's the honest breakdown:

- ✅ **Works with zero backend:** while the Polaris tab is open (or the browser process is alive), the app schedules an in-session reminder via the service worker (`SCHEDULE_REMINDER` message) roughly 1 hour before a task's due time. This covers "I have Polaris open in a background tab."
- ⚙️ **Needs a tiny backend to work when the browser is fully closed:** true background push means *some server* holds each device's `PushSubscription` and calls the [Web Push protocol](https://web.dev/articles/push-notifications-web-push-protocol) at the right time. Polaris already saves the subscription object to Firestore (`syncCodes/{code}/meta/pushSubscription`) so a lightweight scheduled function can pick it up — you just need to write that one function.

### 3.1 Generate VAPID keys
VAPID keys authenticate your server to push services (Chrome, Firefox, etc.) without a full backend framework.

```bash
npm install -g web-push
web-push generate-vapid-keys
```

This prints a public and private key pair. Paste the **public** key into `index.html`:

```js
const VAPID_PUBLIC_KEY = "BEXAMPLE_PUBLIC_KEY...";
```

Keep the **private** key secret — it belongs on your server only, never in `index.html`.

### 3.2 (Optional) sending real push messages
A minimal example using a Firebase Cloud Function (Node) that reads a subscription from Firestore and sends a push — deploy this only if you want reminders to fire while the browser is fully closed:

```js
// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const webpush = require("web-push");
admin.initializeApp();

webpush.setVapidDetails(
  "mailto:you@example.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

exports.sendReminder = functions.https.onCall(async (data) => {
  const { syncCode, title, body, url } = data;
  const snap = await admin.firestore()
    .doc(`syncCodes/${syncCode}/meta/pushSubscription`).get();
  if (!snap.exists) return { sent: false };
  const { subscription } = snap.data();
  await webpush.sendNotification(subscription, JSON.stringify({ title, body, url }));
  return { sent: true };
});
```

You'd then call this from a scheduled Cloud Function (`functions.pubsub.schedule('every 15 minutes')`) that checks upcoming due dates in Firestore and calls `sendReminder` for anything about to be due. This is genuinely optional — Polaris is fully usable without it.

### 3.3 Without any of this
If you skip Firebase and VAPID entirely, Polaris still works great as a local task list with in-session reminders and the **"Enable Reminders"** button simply turns on browser notification permission for those in-session nudges.

---

## 4. Hosting on GitHub Pages

Polaris is a static site — any static host works (Netlify, Vercel, Cloudflare Pages, S3). GitHub Pages is free and simple, but by far the most common reason people hit a **404 right after deploying** is a folder-nesting mistake — read step 2 carefully.

1. Create a new GitHub repository, e.g. `polaris`.
2. **Add the *contents* of the `polaris/` folder to the repo root — not the folder itself.** If you downloaded the zip, open it and drag `index.html`, `manifest.json`, `sw.js`, `icons/`, and `SETUP.md` straight into the repository (or into your local clone's top-level folder). Do **not** end up with a structure like `your-repo/polaris/index.html` — GitHub Pages serves from the root of the branch/folder you select in step 5, so if `index.html` isn't sitting right there, the root URL 404s (Pages doesn't auto-detect subfolders unless you explicitly tell it to).

   ✅ Correct — `index.html` is directly in the repo root:
   ```
   your-repo/
   ├── index.html
   ├── manifest.json
   ├── sw.js
   ├── icons/
   └── SETUP.md
   ```
   ❌ Wrong — this 404s at `your-repo-name.github.io`:
   ```
   your-repo/
   └── polaris/
       ├── index.html
       └── ...
   ```
3. Add a `.nojekyll` file (empty file, no extension) at the repo root. GitHub Pages runs everything through Jekyll by default, which can silently mishandle files/folders that start with an underscore or otherwise don't look like a normal Jekyll site — an empty `.nojekyll` file turns that processing off so your files are served exactly as-is:
   ```bash
   touch .nojekyll
   ```
4. Commit and push:
   ```bash
   git init
   git add .
   git commit -m "Polaris PWA"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/polaris.git
   git push -u origin main
   ```
5. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)`** → **Save**.
6. Give it a minute — the first deploy after enabling Pages typically takes 1–3 minutes. You can watch progress under the repo's **Actions** tab (look for a "pages build and deployment" run).
7. Your app will be live at:
   ```
   https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/
   ```
   (If your repo is literally named `YOUR-USERNAME.github.io`, it's served from the bare domain instead, with no `/repo-name/` segment — adjust the Azure redirect URI in the next step accordingly.)
8. **Important:** go back and update:
   - The Azure **Redirect URI** (§2.1) to match this exact live URL plus `index.html`, e.g. `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/index.html`.
   - Nothing else needs the URL — `manifest.json`'s paths are all relative.

GitHub Pages serves over HTTPS automatically, which is required for service workers, push notifications, and MSAL popups to work.

**Still 404ing?** Open the repo on GitHub.com and confirm you can see `index.html` by clicking directly into the root file listing (not a `polaris/` subfolder) — that view is the same one Pages serves from, so if you can't find `index.html` there, that's the fix. Also double-check **Settings → Pages** shows a green "Your site is live at…" banner, not still "not published."

---

## 5. Installing the PWA on iOS & Android

### Android (Chrome)
1. Visit your hosted Polaris URL in Chrome.
2. Tap the **⋮** menu → **Add to Home screen** (or wait for the automatic "Install app" banner).
3. Confirm — Polaris now opens full-screen from your home screen, with its own icon.
4. Notification permission (from the bell icon or Settings → Reminders → Enable) works the same as any installed Android app.

### iOS / iPadOS (Safari)
1. Visit your hosted Polaris URL in **Safari** (installation only works from Safari, not Chrome/Firefox on iOS).
2. Tap the **Share** icon (square with an arrow) → **Add to Home Screen**.
3. Confirm the name ("Polaris") and tap **Add**.
4. Launch Polaris from the home screen icon — it opens without Safari's address bar, using the colors set in `manifest.json` / the `apple-mobile-web-app` meta tags.
5. **Push notifications on iOS** require iOS 16.4+ **and** the app must be installed to the Home Screen first (Safari tabs can't receive push). After installing, open the installed app and tap **Enable Reminders** — iOS will show its native permission prompt.

### Desktop (Chrome / Edge)
1. Visit the URL — an install icon (⊕ or a monitor-with-arrow) appears in the address bar.
2. Click it → **Install**. Polaris opens as a standalone window, pinned to your taskbar/dock like a native app.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| 404 at your `github.io` URL right after deploying | Almost always `index.html` ended up in a subfolder (e.g. `your-repo/polaris/index.html`) instead of the repo root — see [§4 step 2](#4-hosting-on-github-pages). Also give it 1–3 minutes after first enabling Pages, and confirm **Settings → Pages** shows "Your site is live." |
| "local only" badge never changes | `FIREBASE_CONFIG` still has placeholder values, or Firestore rules are blocking access — check the browser console. |
| Sync code entered but nothing appears | Double-check the code was copied exactly (case doesn't matter, but typos do); confirm both devices are online. |
| "Connect Outlook" does nothing | `MSAL_CONFIG.auth.clientId` still has a placeholder — the app intentionally no-ops until a real client ID is set. |
| Console shows "MSAL init failed" with a bare `Event {isTrusted: true, ...}` (no real error message) | This is a script **load** failure, not an auth error — it means the browser couldn't fetch `vendor/msal-browser.min.js`. Confirm the `vendor/` folder was actually deployed alongside `index.html` (it's easy to miss when copying files manually — check it's sitting right next to `index.html`, `manifest.json`, etc. on your host). The Settings panel will also show "Couldn't load Microsoft sign-in" with a **Retry** button once this happens, instead of failing silently. |
| Microsoft popup blocked | Some browsers block popups triggered outside a direct click — make sure you're clicking the Connect button itself, and allow popups for the site. |
| `AADSTS50011: redirect URI mismatch` | The Azure app's Redirect URI doesn't exactly match the page URL (protocol, domain, and path must match character-for-character). |
| Notifications never fire | `Notification.requestPermission()` was denied, or the browser/OS has notifications disabled for the site — check site settings. Real background push additionally needs the optional server piece from [§3.2](#32-optional-sending-real-push-messages). |
| Service worker not updating after a deploy | Browsers cache service workers aggressively — hard refresh (Ctrl/Cmd+Shift+R) or bump `CACHE_NAME` in `sw.js` to force clients to pick up the new version. |

---

## Data model reference (for anyone extending Polaris)

**Task object** (stored per-user locally, and at `syncCodes/{code}/tasks/{taskId}` when synced):
```json
{
  "id": "string",
  "title": "string",
  "category": "classes | jobs | extracurriculars | personal | <custom>",
  "subcat": "subcategory id or null",
  "dueDate": "ISO 8601 date string or null",
  "dueTime": "HH:MM 24h string or null",
  "status": "todo | inprogress | done",
  "recurring": "boolean — true excludes it from Kanban",
  "notes": "string",
  "createdAt": "ISO 8601 string",
  "completedAt": "ISO 8601 string or null"
}
```

**Categories config** (stored locally, and at `syncCodes/{code}/meta/config`):
```json
{
  "classes": {
    "name": "Classes",
    "color": "#6C8873",
    "subcats": [
      { "id": "orbital", "name": "Orbital Mechanics", "code": "AE302" }
    ]
  }
}
```

Quick Add matches the **first word** of what you type (case-insensitive) against every subcategory's `code`. If it matches, that word is stripped and the task is tagged automatically; the rest of the text is scanned for a date phrase (`today`, `tomorrow`, weekday names, `next friday`, `in 3 days`, `3/15`, `March 15`) and an optional time (`5pm`, `2:30pm`), both of which are also stripped, leaving a clean title.
