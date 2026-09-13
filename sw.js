// ============================================================================
// Polaris — Service Worker
// Handles: app-shell caching for offline/installed use, Web Push notifications,
// and reminder scheduling messages posted from the main app.
// ============================================================================

const CACHE_NAME = "polaris-cache-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./vendor/msal-browser.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png"
];

// ---- Install: pre-cache the app shell -------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// ---- Activate: clean up old caches -----------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ---- Fetch: cache-first for the app shell, network-first for everything else
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never intercept calls to Firebase, Microsoft Graph/MSAL, or other APIs —
  // those need to always hit the network.
  if (
    url.origin !== self.location.origin ||
    url.hostname.includes("googleapis") ||
    url.hostname.includes("firebaseio") ||
    url.hostname.includes("microsoftonline") ||
    url.hostname.includes("graph.microsoft.com")
  ) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

// ---- Web Push: show a notification when a push message arrives ------------
// Requires a server (or serverless function) that holds the subscription
// object saved by the app and sends a payload shaped like:
// { title, body, url, tag }
self.addEventListener("push", (event) => {
  let data = { title: "Polaris", body: "You have a reminder.", url: "./index.html" };
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: data.tag || "polaris-reminder",
    data: { url: data.url || "./index.html" },
    vibrate: [80, 40, 80],
    requireInteraction: false
  };

  event.waitUntil(self.registration.showNotification(data.title || "Polaris", options));
});

// ---- Notification click: focus or open the app -----------------------------
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "./index.html";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if (client.url.includes("index.html") && "focus" in client) {
          client.postMessage({ type: "NOTIFICATION_CLICK", url: targetUrl });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// ---- Local, in-session reminder scheduling ---------------------------------
// Real background push (while the app is fully closed) needs a server to call
// the Push service — see SETUP.md. As a best-effort supplement, the app can
// ask this worker to fire a local notification after a delay while the
// browser process is alive (covers "app open in another tab / minimized").
const timers = new Map();

self.addEventListener("message", (event) => {
  const msg = event.data || {};

  if (msg.type === "SCHEDULE_REMINDER") {
    const { id, title, body, delay, url } = msg;
    if (timers.has(id)) clearTimeout(timers.get(id));
    const t = setTimeout(() => {
      self.registration.showNotification(title || "Polaris", {
        body: body || "A task is coming up.",
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        tag: `reminder-${id}`,
        data: { url: url || "./index.html" }
      });
      timers.delete(id);
    }, Math.max(0, delay));
    timers.set(id, t);
  }

  if (msg.type === "CANCEL_REMINDER") {
    if (timers.has(msg.id)) {
      clearTimeout(timers.get(msg.id));
      timers.delete(msg.id);
    }
  }
});
