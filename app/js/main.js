/**
 * main.js — Démarrage de Mon Budget : navigation, écrans, mise à jour hors ligne.
 *
 * Version : 0.4.3
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Navigation par adresse (#/accueil, #/trier, #/journal, #/resume, #/importer, #/factures[/…],
 * #/reglages[/…]). Sur iPad (≥ 900 px de large), Importer, Factures et Réglages s'ouvrent dans une fenêtre centrée ;
 * sur iPhone, ils prennent tout l'écran avec un bouton « Retour ».
 *
 * Historique :
 *   0.2.0  FRE (Fidag)  Première version : coquille, écrans vides, service worker.
 *   0.3.0  FRE (Fidag)  Sous-pages de Réglages (personnes, comptes, catégories), écrans
 *                       asynchrones (lecture de la base), message si le stockage est indisponible.
 *   0.4.0  FRE (Fidag)  Importer, À trier, Factures de carte ; pastille du nombre à trier ;
 *                       accueil avec opérations à trier et factures à vérifier.
 *   0.4.3  FRE (Fidag)  « À trier » remplit l'écran (colonnes qui défilent séparément).
 */

import { formatDateLong, formatMonth } from '../src/core/format.js';
import { icon } from './ui.js';
import { getDb } from './store.js';
import { reglagesView } from './ecran-reglages.js';
import { trierView } from './ecran-trier.js';
import { importerView, resetImporterIfDone } from './ecran-importer.js';
import { facturesView } from './ecran-factures.js';
import { billsToCheck } from '../src/core/cartes.js';

const WIDE = window.matchMedia('(min-width: 900px)');

/** Écrans principaux (barre latérale et onglets). */
const MAIN_ROUTES = [
  { id: 'accueil', label: 'Accueil' },
  { id: 'trier', label: 'À trier' },
  { id: 'journal', label: 'Journal' },
  { id: 'resume', label: 'Résumé' },
];
/** Écrans ouverts en fenêtre sur iPad. */
const SHEET_ROUTES = ['importer', 'factures', 'reglages'];

/* ---------- Contenu des écrans ---------- */

function emptyCard(iconName, title, text) {
  return `<section class="card empty">
    <span class="empty-icon">${icon(iconName)}</span>
    <h2>${title}</h2>
    <p>${text}</p>
  </section>`;
}

const staticView = (title, html) => ({ title, parent: null, render(root) { root.innerHTML = html(); } });

function accueilView() {
  return {
    title: 'Accueil',
    parent: null,
    async render(root) {
      const today = new Date();
      const db = await getDb();
      const [pending, total, bills] = await Promise.all([
        db.countWhere('transactions', 'status', 'a-trier'), db.count('transactions'), billsToCheck(db)]);
      root.innerHTML = `<div class="page-head">
          <div>
            <h1>Bonjour !</h1>
            <p class="sub">${formatDateLong(today, { capital: true })} · ${formatMonth(today)}</p>
          </div>
          <a class="btn btn-secondary home-settings" href="#/reglages">${icon('reglages')}Réglages</a>
        </div>
        ${pending ? `<a class="todo" href="#/trier">
            <span class="todo-count">${pending}</span>
            <span class="row-text"><span class="row-title">${pending > 1 ? 'Opérations à trier' : 'Opération à trier'}</span>
            <span class="row-sub">Environ ${Math.max(1, Math.round(pending / 4))} minute${pending > 7 ? 's' : ''}</span></span>
            <span class="row-title">Trier</span></a>` : ''}
        ${bills.length ? `<a class="todo" href="#/factures">
            <span class="todo-count">${bills.length}</span>
            <span class="row-text"><span class="row-title">${bills.length > 1 ? 'Factures de carte à vérifier' : 'Facture de carte à vérifier'}</span>
            <span class="row-sub">Rattacher les achats des cartes</span></span>
            <span class="row-title">Vérifier</span></a>` : ''}
        ${total ? '' : emptyCard('importer', 'Pas encore d’opérations',
          'Pour commencer, importez le fichier de votre banque. Vos opérations apparaîtront ici.')}
        ${total && !pending && !bills.length ? `<p class="flash">${icon('ok')}Tout est trié. Le journal et le résumé du mois arrivent dans la prochaine version.</p>` : ''}
        <a class="btn btn-primary btn-wide btn-import" href="#/importer">${icon('importer')}Importer un relevé</a>`;
    },
  };
}

const VIEWS = {
  accueil: () => accueilView(),
  trier: () => trierView(),
  factures: (path) => facturesView(path),
  journal: () => staticView('Journal', () => `<div class="page-head"><div><h1>Journal</h1>
        <p class="sub">${formatMonth(new Date())}</p></div></div>
      ${emptyCard('journal', 'Le journal est vide',
        'Toutes vos dépenses et rentrées seront listées ici, mois par mois.')}`),
  resume: () => staticView('Résumé', () => `<div class="page-head"><div><h1>Résumé du mois</h1>
        <p class="sub">${formatMonth(new Date())}</p></div></div>
      ${emptyCard('resume', 'Pas encore de résumé',
        'Le résumé montrera ce qui est entré, ce qui est sorti, et pour qui.')}`),
  importer: () => importerView(),
  reglages: (path) => reglagesView(path),
};

/* ---------- Navigation ---------- */

const view = document.getElementById('vue');
const dialog = document.getElementById('fenetre');
const dialogBody = document.getElementById('fenetre-contenu');
const dialogBack = dialog.querySelector('[data-back]');
let lastMainRoute = 'accueil';
let renderCount = 0;

function buildNav() {
  const link = (cls) => (r) => `<a class="${cls}" href="#/${r.id}" data-route="${r.id}">${icon(r.id)}${r.label}${
    r.id === 'trier' ? '<span class="badge" data-count="trier" hidden></span>' : ''}</a>`;
  document.querySelector('[data-nav="main"]').innerHTML = MAIN_ROUTES.map(link('nav-link')).join('');
  document.querySelector('[data-nav="tabs"]').innerHTML = MAIN_ROUTES.map(link('tab')).join('');
}

function currentRoute() {
  const [id, ...path] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return id in VIEWS ? { id, path } : { id: 'accueil', path: [] };
}

function markCurrent(id) {
  for (const a of document.querySelectorAll('[data-route]')) {
    if (a.dataset.route === id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function storageError(root) {
  root.innerHTML = `<section class="card alert" role="alert">
    <h2>${icon('attention')}Les données ne peuvent pas être lues</h2>
    <p>Fermez l’app complètement puis rouvrez-la. Si le message revient, ouvrez l’app avec Safari
    (pas en navigation privée).</p></section>`;
}

/** Affiche un écran ; ignore le résultat si une autre navigation a eu lieu entre-temps. */
async function paint(v, root, ticket) {
  // Les gestionnaires d'un écran précédent ne doivent pas rester actifs.
  root.onclick = null;
  root.onchange = null;
  try {
    await v.render(root);
  } catch (e) {
    if (ticket === renderCount) storageError(root);
    console.error(e);
  }
}

async function renderMain(id, ticket) {
  lastMainRoute = id;
  // « À trier » remplit l'écran : la liste et le formulaire défilent chacun de leur côté (iPad).
  view.classList.toggle('view-fill', id === 'trier');
  const v = VIEWS[id]([]);
  document.title = `${v.title} — Mon Budget`;
  await paint(v, view, ticket);
}

async function render() {
  const ticket = ++renderCount;
  const { id, path } = currentRoute();
  if (id !== 'importer') resetImporterIfDone();
  updateBadge();

  if (SHEET_ROUTES.includes(id)) {
    const v = VIEWS[id](path);
    document.title = `${v.title} — Mon Budget`;
    markCurrent(id);
    if (WIDE.matches) {
      if (!view.innerHTML) renderMain(lastMainRoute, ticket);
      document.getElementById('fenetre-titre').textContent = v.title;
      dialogBack.hidden = !v.parent;
      dialogBack.setAttribute('href', v.parent ?? '#/');
      if (!dialog.open) dialog.showModal();
      await paint(v, dialogBody, ticket);
      dialog.scrollTop = 0;
    } else {
      if (dialog.open) dialog.close();
      const back = v.parent ?? `#/${lastMainRoute}`;
      view.innerHTML = `<div class="page-head"><div><h1>${v.title}</h1></div>
          <a class="btn btn-secondary" href="${back}">${icon('retour')}Retour</a></div>
        <div class="stack" id="sous-vue"></div>`;
      window.scrollTo(0, 0);
      view.focus({ preventScroll: true });
      await paint(v, document.getElementById('sous-vue'), ticket);
    }
    return;
  }
  if (dialog.open) dialog.close();
  markCurrent(id);
  window.scrollTo(0, 0);
  await renderMain(id, ticket);
  view.focus({ preventScroll: true });
}

/** Pastille « À trier » de la barre latérale et des onglets. */
async function updateBadge() {
  try {
    const n = await (await getDb()).countWhere('transactions', 'status', 'a-trier');
    for (const b of document.querySelectorAll('[data-count="trier"]')) {
      b.textContent = n > 99 ? '99+' : String(n);
      b.hidden = n === 0;
      b.setAttribute('aria-label', `${n} à trier`);
    }
  } catch { /* la base n'est pas disponible : l'écran l'explique */ }
}

// Après un import ou un tri : l'écran principal (sous la fenêtre) et la pastille se mettent à jour.
document.addEventListener('donnees-modifiees', () => {
  updateBadge();
  if (dialog.open) renderMain(lastMainRoute, renderCount);
});

dialog.addEventListener('close', () => {
  if (SHEET_ROUTES.includes(currentRoute().id)) location.hash = `#/${lastMainRoute}`;
});
dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
WIDE.addEventListener('change', render);
window.addEventListener('hashchange', render);

buildNav();
render();
// Ouvre la base dès le démarrage (installe les données de départ au premier lancement).
getDb().catch(() => {});

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
