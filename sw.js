// Funciona sem internet: tenta a rede primeiro (para receber atualizações) e usa a cópia guardada quando não há ligação.
// Os módulos do Firebase (gstatic, com versão fixa no endereço) ficam guardados para abrir sem internet.
const CACHE = 'pcorc-v6';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'ifc.js', 'sync.js', 'firebase-config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/logo-empresa.webp'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (url.startsWith('https://www.gstatic.com/firebasejs/')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
    })));
    return;
  }
  if (!url.startsWith(self.location.origin)) return; // a base de dados (Firestore) trata da sua própria cache
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
