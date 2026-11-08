/**
 * main.js — Démarrage de Mon Budget : navigation, écrans, mise à jour hors ligne.
 *
 * Version : 0.2.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Navigation par adresse (#/accueil, #/trier, #/journal, #/resume, #/importer, #/reglages).
 * Sur iPad (≥ 900 px de large), Importer et Réglages s'ouvrent dans une fenêtre centrée ;
 * sur iPhone, ils prennent tout l'écran avec un bouton « Retour ».
 *
 * Historique :
 *   0.2.0  FRE (Fidag)  Première version : coquille, écrans vides, service worker.
 */

import { APP_VERSION } from './version.js';
import { formatDateLong, formatMonth } from '../src/core/format.js';

const WIDE = window.matchMedia('(min-width: 900px)');

/* Icônes au trait (même dessin que la maquette). */
const ICONS = {
  accueil: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  trier: '<path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
  journal: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  resume: '<path d="M5 20V11M12 20V5M19 20v-6M3 20h18"/>',
  importer: '<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/>',
  reglages: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  retour: '<path d="M15 6l-6 6 6 6"/>',
};
const icon = (name) => `<svg aria-hidden="true" viewBox="0 0 24 24">${ICONS[name]}</svg>`;

/** Écrans principaux (barre latérale et onglets). */
const MAIN_ROUTES = [
  { id: 'accueil', label: 'Accueil' },
  { id: 'trier', label: 'À trier' },
  { id: 'journal', label: 'Journal' },
  { id: 'resume', label: 'Résumé' },
];
/** Écrans ouverts en fenêtre sur iPad. */
const SHEET_ROUTES = { importer: 'Importer un relevé', reglages: 'Réglages' };

/* ---------- Contenu des écrans (vides pour l'instant) ---------- */

function emptyCard(iconName, title, text) {
  return `<section class="card empty">
    <span class="empty-icon">${icon(iconName)}</span>
    <h2>${title}</h2>
    <p>${text}</p>
  </section>`;
}

const VIEWS = {
  accueil() {
    const today = new Date();
    return `<div class="page-head">
        <div>
          <h1>Bonjour !</h1>
          <p class="sub">${formatDateLong(today, { capital: true })} · ${formatMonth(today)}</p>
        </div>
        <a class="btn btn-secondary home-settings" href="#/reglages">${icon('reglages')}Réglages</a>
      </div>
      ${emptyCard('importer', 'Pas encore d’opérations',
        'Pour commencer, importez le fichier de votre banque. Vos opérations apparaîtront ici.')}
      <a class="btn btn-primary btn-wide btn-import" href="#/importer">${icon('importer')}Importer un relevé</a>`;
  },
  trier() {
    return `<div class="page-head"><div><h1>À trier</h1></div></div>
      ${emptyCard('trier', 'Rien à trier',
        'Quand vous importerez un relevé, les opérations à classer apparaîtront ici, une à la fois.')}`;
  },
  journal() {
    return `<div class="page-head"><div><h1>Journal</h1>
        <p class="sub">${formatMonth(new Date())}</p></div></div>
      ${emptyCard('journal', 'Le journal est vide',
        'Toutes vos dépenses et rentrées seront listées ici, mois par mois.')}`;
  },
  resume() {
    return `<div class="page-head"><div><h1>Résumé du mois</h1>
        <p class="sub">${formatMonth(new Date())}</p></div></div>
      ${emptyCard('resume', 'Pas encore de résumé',
        'Le résumé montrera ce qui est entré, ce qui est sorti, et pour qui.')}`;
  },
  importer() {
    return emptyCard('importer', 'Bientôt disponible',
      'Ici, vous choisirez le fichier téléchargé depuis votre banque (UBS, BCVs ou Mastercard).');
  },
  reglages() {
    return `<section class="card">
        <h2>À propos</h2>
        <dl class="info-list">
          <dt>Application</dt><dd>Mon Budget</dd>
          <dt>Version</dt><dd>${APP_VERSION}</dd>
        </dl>
      </section>
      ${emptyCard('reglages', 'Comptes, personnes et catégories',
        'Ces réglages arriveront dans la prochaine version.')}`;
  },
};

/* ---------- Navigation ---------- */

const view = document.getElementById('vue');
const dialog = document.getElementById('fenetre');
let lastMainRoute = 'accueil';

function buildNav() {
  document.querySelector('[data-nav="main"]').innerHTML = MAIN_ROUTES.map((r) =>
    `<a class="nav-link" href="#/${r.id}" data-route="${r.id}">${icon(r.id)}${r.label}${
      r.id === 'trier' ? '<span class="badge" data-count="trier" hidden></span>' : ''}</a>`).join('');
  document.querySelector('[data-nav="tabs"]').innerHTML = MAIN_ROUTES.map((r) =>
    `<a class="tab" href="#/${r.id}" data-route="${r.id}">${icon(r.id)}${r.label}${
      r.id === 'trier' ? '<span class="badge" data-count="trier" hidden></span>' : ''}</a>`).join('');
}

function currentRoute() {
  const id = location.hash.replace(/^#\/?/, '');
  return id in VIEWS ? id : 'accueil';
}

function markCurrent(id) {
  for (const a of document.querySelectorAll('[data-route]')) {
    if (a.dataset.route === id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function renderMain(id) {
  lastMainRoute = id;
  view.innerHTML = VIEWS[id]();
  const title = MAIN_ROUTES.find((r) => r.id === id).label;
  document.title = `${title} — Mon Budget`;
}

function render() {
  const id = currentRoute();
  if (id in SHEET_ROUTES) {
    document.title = `${SHEET_ROUTES[id]} — Mon Budget`;
    markCurrent(id);
    if (WIDE.matches) {
      if (!view.innerHTML) renderMain(lastMainRoute);
      document.getElementById('fenetre-titre').textContent = SHEET_ROUTES[id];
      document.getElementById('fenetre-contenu').innerHTML = VIEWS[id]();
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
      view.innerHTML = `<div class="page-head"><div><h1>${SHEET_ROUTES[id]}</h1></div>
          <a class="btn btn-secondary" href="#/${lastMainRoute}">${icon('retour')}Retour</a></div>
        ${VIEWS[id]()}`;
      view.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    return;
  }
  if (dialog.open) dialog.close();
  renderMain(id);
  markCurrent(id);
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

dialog.addEventListener('close', () => {
  if (currentRoute() in SHEET_ROUTES) location.hash = `#/${lastMainRoute}`;
});
dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
WIDE.addEventListener('change', render);
window.addEventListener('hashchange', render);

buildNav();
render();

/* ---------- Hors ligne et mise à jour ---------- */

// Vrai seulement après « Mettre à jour » : au premier lancement, le service worker
// prend la main sans qu'il faille recharger la page.
let updateRequested = false;

function showUpdate(worker) {
  const bar = document.getElementById('maj');
  bar.hidden = false;
  document.getElementById('maj-bouton').onclick = () => {
    bar.hidden = true;
    updateRequested = true;
    worker.postMessage('miseAJour');
  };
}

if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !updateRequested) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
      });
    });
    // Vérifie s'il y a une nouvelle version quand l'app revient au premier plan.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => { /* hors ligne au premier lancement : rien à faire */ });
}
