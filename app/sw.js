/**
 * sw.js — Service worker : met toute l'app en cache pour qu'elle marche hors ligne.
 *
 * Version : 0.5.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * La nouvelle version s'installe en arrière-plan puis attend : l'app affiche
 * « Nouvelle version disponible — Mettre à jour » et n'active la nouvelle version
 * que lorsque la personne appuie sur le bouton (message « miseAJour »).
 *
 * Historique :
 *   0.2.0  FRE (Fidag)  Première version.
 *   0.3.0  FRE (Fidag)  Nouveaux fichiers : base de données, réglages, outils d'interface.
 *   0.4.0  FRE (Fidag)  Nouveaux fichiers : import, règles, factures de carte, écrans.
 *   0.4.1  FRE (Fidag)  Lecteur CSV.
 *   0.4.2  FRE (Fidag)  Aides de tri (tri.js).
 *   0.4.3  FRE (Fidag)  Version 0.4.3 (styles et écran À trier).
 *   0.4.4  FRE (Fidag)  Fenêtre de choix de catégorie (choix-categorie.js).
 *   0.4.5  FRE (Fidag)  Fenêtre de choix générique (choix.js).
 *   0.4.6  FRE (Fidag)  Version 0.4.6.
 *   0.5.0  FRE (Fidag)  Journal, Résumé, modifier une opération.
 */

const VERSION = '0.5.0';
const CACHE = `mon-budget-${VERSION}`;

/** Tous les fichiers de l'app (vérifié par tests/app.test.mjs). */
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/version.js',
  './js/ui.js',
  './js/store.js',
  './js/ecran-reglages.js',
  './js/ecran-trier.js',
  './js/ecran-importer.js',
  './js/ecran-factures.js',
  './js/choix.js',
  './js/mois.js',
  './js/operation.js',
  './js/ecran-journal.js',
  './js/ecran-resume.js',
  './src/core/format.js',
  './src/core/reglages.js',
  './src/core/regles.js',
  './src/core/cartes.js',
  './src/core/import.js',
  './src/core/csv.js',
  './src/core/tri.js',
  './src/core/journal.js',
  './src/data/db.js',
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
