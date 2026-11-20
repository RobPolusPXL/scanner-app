// Service worker: app werkt na de eerste keer ook offline (camera-OCR; spraak heeft wel internet nodig).
const VERSION = 'v7';
const CORE = `core-${VERSION}`;
const BIG = 'ocr-v1'; // tekstherkenning + taalmodel: groot, verandert zelden
const CORE_FILES = ['./', 'index.html', 'css/style.css?v=5', 'data/straten.js?v=5', 'js/match.js?v=5', 'js/app.js?v=5', 'manifest.webmanifest', 'icons/icon-192.png?v=2'];
const BIG_FILES = ['vendor/tesseract.min.js', 'vendor/worker.min.js', 'vendor/core/tesseract-core-simd-lstm.wasm.js', 'vendor/core/tesseract-core-lstm.wasm.js', 'lang/nld.traineddata.gz'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    await (await caches.open(CORE)).addAll(CORE_FILES);
    const big = await caches.open(BIG);
    await Promise.all(BIG_FILES.map(async (f) => { if (!(await big.match(f))) await big.add(f).catch(() => {}); }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CORE && k !== BIG) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isBig = BIG_FILES.some((f) => url.pathname.endsWith('/' + f));
  if (isBig) {
    // grote bestanden: eerst uit cache
    e.respondWith(caches.open(BIG).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  // de rest: eerst netwerk (altijd nieuwste versie), cache als je offline bent
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) caches.open(CORE).then((c) => c.put(e.request, r.clone()));
    return r;
  }).catch(async () => (await caches.match(e.request, { ignoreSearch: false })) || caches.match('index.html')));
});
