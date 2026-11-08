/**
 * sw.js — Service worker : met toute l'app en cache pour qu'elle marche hors ligne.
 *
 * Version : 0.2.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * La nouvelle version s'installe en arrière-plan puis attend : l'app affiche
 * « Nouvelle version disponible — Mettre à jour » et n'active la nouvelle version
 * que lorsque la personne appuie sur le bouton (message « miseAJour »).
 *
 * Historique :
 *   0.2.0  FRE (Fidag)  Première version.
 */

const VERSION = '0.2.0';
const CACHE = `mon-budget-${VERSION}`;

/** Tous les fichiers de l'app (vérifié par tests/app.test.mjs). */
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/version.js',
  './src/core/format.js',
  './src/core/text.js',
  './src/core/xlsx.js',
  './src/importers/ubs.js',
  './src/data/seed.json',
  './fonts/atkinson-hyperlegible-400.woff2',
  './fonts/atkinson-hyperlegible-700.woff2',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mon-budget-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'miseAJour') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('./index.html');
      return fetch(req);
    }),
  );
});
