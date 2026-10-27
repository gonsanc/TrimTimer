// sw.js — service worker.
//
// Dos trabajos:
//  1. Hacer que la app funcione sin red (el shell entero es estatico).
//  2. Cumplir el criterio de instalabilidad de Chrome en Android: sin un
//     handler de 'fetch' no se genera la WebAPK y solo sale un acceso directo.
//
// NO cacheamos cubing.js: es otro origen y la app ya tiene un generador de
// respaldo para cuando no hay red.

const CACHE = 'trimtimer-v2';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/timer.js',
  './js/stats.js',
  './js/scramble.js',
  './js/sync.js',
  './js/sound.js',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // CDN y API de sync, a la red

  // Stale-while-revalidate: responde rapido de cache y refresca por detras.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached || caches.match('./index.html'));

      return cached || network;
    })
  );
});
