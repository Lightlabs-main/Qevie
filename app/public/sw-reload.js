/*
 * Imported into the generated Workbox service worker (see vite.config.ts
 * workbox.importScripts).
 *
 * Workbox is already configured with skipWaiting + clientsClaim +
 * cleanupOutdatedCaches, so a new service worker activates immediately, takes
 * control, and purges the previous precache. What it does NOT do on its own is
 * refresh pages that are already open with the stale shell loaded into memory —
 * a returning user would keep seeing the old (e.g. duckdns) bundle until they
 * happened to reload by hand.
 *
 * This forces every open window client to reload once when a NEW worker
 * activates, so returning users move onto the fresh bundle on their next visit
 * instead of staying pinned to the cached one. activate only fires when the
 * worker actually changes, and the reloaded page is served by the now-active
 * worker, so this runs exactly once per deploy with no reload loop.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.clients.claim();
        const clients = await self.clients.matchAll({ type: "window" });
        await Promise.all(
          clients.map((client) =>
            typeof client.navigate === "function"
              ? client.navigate(client.url).catch(() => undefined)
              : undefined,
          ),
        );
      } catch (err) {
        // Best-effort only — never block activation on a reload failure.
        console.warn("[qevie sw] client reload skipped:", err);
      }
    })(),
  );
});
