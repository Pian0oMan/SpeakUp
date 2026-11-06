// SERVICE WORKER: a small script the browser runs in the background for Speak Up.
// Having one (plus static/manifest.json) is what lets people INSTALL Speak Up as an app,
// on their phone's home screen or as a desktop app.
//
// It always asks the server first, so a new version of the site shows up right away.
// Only when there's no internet does it use the copy it saved last time
// (then the page still opens, and says it can't connect).
const CACHE = "speakup-v1";

self.addEventListener("install", () => self.skipWaiting());              // use a new version right away
self.addEventListener("activate", event => event.waitUntil(clients.claim()));

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  // Only the site's own pages and files: not the API, the real-time connection, or other websites
  if (request.method !== "GET" || url.origin !== location.origin ||
      url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        const copy = response.clone();
        if (response.ok) caches.open(CACHE).then(cache => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
