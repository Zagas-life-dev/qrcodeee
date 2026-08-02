/**
 * Service worker — Web Push delivery (§5.2 step 3).
 *
 * This is the ONLY way to reach the scanned person while their app is closed.
 * Realtime covers the app-open case; neither covers the other.
 *
 * Deliberately has no `fetch` handler. An empty pass-through fetch listener is a
 * common cargo-cult addition that adds a round trip through the worker for every
 * request and buys nothing — modern install criteria don't require one, and this
 * app has no offline story to implement yet.
 */

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close, so a
  // deployed fix to push handling applies on the next visit.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A malformed or non-JSON payload must still surface something rather than
    // silently dropping a notification the user was promised.
    payload = {};
  }

  const title = payload.title || "Skan QR";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/badge-96.png",
    // Collapses repeats of the same event instead of stacking duplicates.
    tag: payload.tag || "qr-connect",
    renotify: Boolean(payload.tag),
    data: { url: typeof payload.url === "string" ? payload.url : "/connections" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = new URL(
    (event.notification.data && event.notification.data.url) || "/connections",
    self.location.origin,
  );
  // Never navigate to another origin from a push payload.
  const url = target.origin === self.location.origin ? target.href : self.location.origin;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Reuse an already-open window where possible — opening a second copy of
      // an installed PWA is disorienting.
      for (const client of windows) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      if (windows.length > 0 && "navigate" in windows[0]) {
        await windows[0].focus();
        return windows[0].navigate(url);
      }
      return self.clients.openWindow(url);
    })(),
  );
});
