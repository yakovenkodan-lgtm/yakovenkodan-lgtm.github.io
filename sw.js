/* Читанка — service worker: оболонка застосунку працює без інтернету.
   Книжки й аудіо сюди не потрапляють: їх кешує сама сторінка (Cache Storage «chitanka-files-*»),
   запити до Google (googleapis.com) не перехоплюються. */
const SHELL_CACHE = 'chitanka-shell-20261109-fwd30';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/config.js', 'js/labels.js', 'js/store.js', 'js/data-demo.js', 'js/data-drive.js', 'js/player.js', 'js/app.js',
  'img/banner-phone.jpg', 'audio/silence.mp3',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/favicon-32.png'
];
const SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('chitanka-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(SCOPE) || url.pathname.includes('/__chitanka/')) return;
  if (req.headers.has('range')) return;
  if (req.mode === 'navigate') {
    // спершу мережа (щоб оновлення доходили), без мережі — збережена сторінка
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(SHELL_CACHE).then((c) => c.put('index.html', cp)); return r; })
      .catch(() => caches.match('index.html', { ignoreSearch: true })));
    return;
  }
  // решта оболонки: з кешу одразу, а в фоні — свіжа копія
  e.respondWith(caches.open(SHELL_CACHE).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok && r.type === 'basic') c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  })));
});
