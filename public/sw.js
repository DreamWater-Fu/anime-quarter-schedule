const CACHE_PREFIX = "anime-quarter-schedule";
const STATIC_CACHE = `${CACHE_PREFIX}-static-v1`;
const DATA_CACHE = `${CACHE_PREFIX}-data-v1`;
const KNOWN_CACHES = [STATIC_CACHE, DATA_CACHE];

const APP_SHELL_PATHS = [
  "./",
  "manifest.webmanifest",
  "icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) =>
        cache.addAll(
          APP_SHELL_PATHS.map((path) => new Request(new URL(path, self.registration.scope), { cache: "reload" }))
        )
      )
      .catch(() => undefined)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(cacheNames.filter((cacheName) => !KNOWN_CACHES.includes(cacheName)).map((cacheName) => caches.delete(cacheName)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isStaticDataRequest(url)) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, STATIC_CACHE, new URL("./", self.registration.scope)));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  }
});

function isStaticDataRequest(url) {
  return url.pathname.endsWith("/static-data/anime.json") || url.pathname.endsWith("/static-data/status.json");
}

function isStaticAssetRequest(request, url) {
  return (
    url.pathname.includes("/_next/static/") ||
    url.pathname.endsWith("/manifest.webmanifest") ||
    url.pathname.endsWith("/icon.svg") ||
    url.pathname.includes("/icons/") ||
    ["font", "image", "script", "style", "worker"].includes(request.destination)
  );
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
