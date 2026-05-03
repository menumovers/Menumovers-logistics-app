// Bestellenbij service worker.
// Handles install/activate, basic same-origin GET caching, Web Push display,
// and integrates with vite-plugin-pwa's injectManifest precache list when built.
// In dev (no plugin), self.__WB_MANIFEST is undefined and precaching is a no-op.

const CACHE_VERSION = "bb-v1";

// vite-plugin-pwa replaces __WB_MANIFEST at build time. Reference it so the
// build-time injection point is satisfied, but we precache lazily on first use.
const PRECACHE_MANIFEST = self.__WB_MANIFEST || [];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        if (PRECACHE_MANIFEST.length > 0) {
          const cache = await caches.open(CACHE_VERSION);
          const urls = PRECACHE_MANIFEST.map((entry) =>
            typeof entry === "string" ? entry : entry.url,
          ).filter(Boolean);
          await cache.addAll(urls).catch(() => {});
        }
      } catch {
        // ignore — precache failures should not block activation
      }
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // Network-first for navigations; cache successful HTML for offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        try {
          const res = await fetch(req);
          if (res && res.ok && res.type !== "opaque") {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        } catch {
          const cached = (await cache.match(req)) || (await cache.match("/"));
          return cached || Response.error();
        }
      })(),
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = { title: "Bestellenbij", body: "" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Bestellenbij", {
      body: payload.body || "",
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      data: payload.data || {},
      tag: payload.tag,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) {
          await c.focus();
          if ("navigate" in c) await c.navigate(target);
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});
