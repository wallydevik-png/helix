// One-release cleanup worker for stale NeurlX app-shell caches.
// Installability is handled by manifest.json; NeurlX does not need an app-shell
// service worker unless offline mode is explicitly rebuilt later.

function isNeurlXAppCache(name) {
  const hasWorkboxBucket = /(^|-)precache-v\d+-|(^|-)runtime-|(^|-)googleAnalytics-/.test(name);
  return /^neurlx-/.test(name) || (hasWorkboxBucket && name.endsWith(self.registration.scope));
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const cacheNames = await caches.keys();
      await Promise.allSettled(cacheNames.filter(isNeurlXAppCache).map((name) => caches.delete(name)));
      await self.clients.claim();
    } finally {
      await self.registration.unregister();
    }
  })());
});
