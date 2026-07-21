// Etikaro — Service Worker
// Strategie: "stale-while-revalidate" für alles, inkl. Tesseract.js- und jsPDF-Dateien.
// Liegt eine Antwort im Cache, wird sie sofort ausgeliefert (auch offline),
// im Hintergrund wird bei bestehender Verbindung aktualisiert.

const CACHE_NAME = 'etikaro-v12';

const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './manifest.json',
  './THIRD-PARTY-NOTICES.txt',
  './tesseract.min.js',
  './worker.min.js',
  './tesseract-core-simd-lstm.wasm.js',
  './tesseract-core-lstm.wasm.js',
  './deu.traineddata.gz',
  './jspdf.umd.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkFetch.catch(() => {});
    return cached;
  }

  const networkResponse = await networkFetch;
  if (networkResponse) return networkResponse;

  if (request.mode === 'navigate') {
    const shell = await cache.match('./index.html');
    if (shell) return shell;
  }

  return new Response(
    'Offline — diese Datei ist noch nicht zwischengespeichert. Bitte einmal mit Internetverbindung öffnen/scannen.',
    { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  );
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(staleWhileRevalidate(event.request));
});
