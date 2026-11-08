/**
 * ecran-trier.js — Écran « À trier » : une opération à la fois, « Pour qui ? » puis « C'est quoi ? ».
 *
 * Version : 0.4.2
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * iPad : liste à gauche + détail ; iPhone : le détail seul avec « 2 sur 7 ».
 * La case « Toujours classer X comme ça » (cochée par défaut) crée ou met à jour la règle.
 * Pour un achat par carte, la personne titulaire de la carte est proposée d'avance.
 *
 * Historique :
 *   0.4.0  FRE (Fidag)  Première version.
 *   0.4.2  FRE (Fidag)  Loupe « Chercher une catégorie » ; ordre « commerces fréquents d'abord » ;
 *                       liste limitée (fluide avec plus de 1000 opérations) ; lignes qui ne se chevauchent plus.
 */

import { icon, esc } from './ui.js';
import { getDb } from './store.js';
import { formatAmount, formatDateLong, displayName } from '../src/core/format.js';
import { listPeople, listCategories, ReglageError } from '../src/core/reglages.js';
import { classify } from '../src/core/regles.js';
import { orderPending, countByMerchant, searchCategories } from '../src/core/tri.js';

/** Catégories proposées d'office avant « Autre… » (les plus utilisées passent devant). */
const FAVORITES = {
  depense: ['alimentation-et-courses', 'menage-et-droguerie', 'pharmacie', 'restaurants', 'cadeaux'],
  recette: ['rente-avs', 'rente-lpp-2e-pilier', 'remboursement-caisse-maladie', 'autres-revenus', 'virement-entrant'],
};
const SHOWN = 5;
/** Nombre d'opérations montrées dans la liste de gauche (iPad). */
const LIST_MAX = 50;

// État de l'écran (gardé entre deux affichages).
const state = { currentId: null, personId: null, categoryId: null, remember: true, showAll: false, message: '', order: 'frequent', query: '' };

function resetChoice() {
  state.personId = null;
  state.categoryId = null;
  state.remember = true;
  state.showAll = false;
  state.query = '';
}

async function load(db) {
  const [pending, people, categories, accounts, classified] = await Promise.all([
    db.getAllWhere('transactions', 'status', 'a-trier'),
    listPeople(db),
    listCategories(db, { archived: false }),
    db.getAll('accounts'),
    db.getAllWhere('transactions', 'status', 'classee'),
  ]);
  const sorted = orderPending(pending, state.order);
  const counts = countByMerchant(pending);
  const usage = new Map();
  for (const t of classified) usage.set(t.categoryId, (usage.get(t.categoryId) ?? 0) + 1);
  return { pending: sorted, counts, people, categories, accounts: new Map(accounts.map((a) => [a.id, a])), usage };
}

function favoritesFor(type, categories, usage) {
  // La facture de carte et les virements restent sous « Autre… » : rares, à choisir exprès.
  const ofType = categories.filter((c) => c.type === type && !c.isCardBill && !c.excludeFromTotals);
  const ranked = [...ofType].sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0));
  const picks = ranked.filter((c) => usage.get(c.id)).slice(0, SHOWN);
  for (const id of FAVORITES[type]) {
    if (picks.length >= SHOWN) break;
    const c = ofType.find((x) => x.id === id);
    if (c && !picks.includes(c)) picks.push(c);
  }
  for (const c of ofType) { if (picks.length >= SHOWN) break; if (!picks.includes(c)) picks.push(c); }
  return picks;
}

function personButtons(people, selected) {
  return people.map((p) => `<button type="button" class="pick pick-person" data-color="${esc(p.color)}"
      data-person="${esc(p.id)}" aria-pressed="${p.id === selected}">${esc(p.name)}</button>`).join('');
}

function categoryButtons(list, selected) {
  return list.map((c) => `<button type="button" class="pick" data-category="${esc(c.id)}"
      aria-pressed="${c.id === selected}">${esc(c.name)}</button>`).join('');
}

function detail(tx, data) {
  const acc = data.accounts.get(tx.accountId);
  const type = tx.amount < 0 ? 'depense' : 'recette';
  const name = displayName(tx.description);
  const favs = favoritesFor(type, data.categories, data.usage);
  if (state.categoryId && !favs.some((c) => c.id === state.categoryId)) {
    const sel = data.categories.find((c) => c.id === state.categoryId);
    if (sel) favs.push(sel);
  }
  const others = (t) => data.categories.filter((c) => c.type === t && !favs.includes(c));
  const allOfType = data.categories.filter((c) => c.type === type);
  if (allOfType.length && !favs.length) favs.push(...allOfType.slice(0, SHOWN));
  const position = data.pending.indexOf(tx) + 1;
  const same = data.counts.get(tx.merchantKey) ?? 1;
  return `<section class="card sort-card" aria-labelledby="op-nom">
      <div class="sort-head">
        <div class="row-text">
          <span class="row-sub">${esc(formatDateLong(tx.date, { capital: true }))} · ${esc(acc?.name ?? 'Compte inconnu')}</span>
          <span class="sort-name" id="op-nom">${esc(name)}</span>
        </div>
        <span class="sort-amount ${tx.amount < 0 ? '' : 'positive'}">${formatAmount(tx.amount)}</span>
      </div>
      <p class="row-sub">Texte de la banque : ${esc(tx.description)}${tx.bankCategory ? `<br>Classement de la banque : ${esc(tx.bankCategory)}` : ''}</p>
      <p class="progress-text">${position} sur ${data.pending.length}</p>

      <h2>Pour qui ?</h2>
      <div class="picks picks-people">${personButtons(data.people, state.personId)}</div>

      <h2>C’est quoi ?</h2>
      <label class="search">
        ${icon('loupe')}<span class="visually-hidden">Chercher une catégorie</span>
        <input type="search" data-chercher value="${esc(state.query)}" placeholder="Chercher une catégorie" autocomplete="off" enterkeyhint="search">
      </label>
      <div class="picks picks-cats" data-resultats${state.query ? '' : ' hidden'}>${state.query ? searchButtons(data, state.query) : ''}</div>
      <div class="picks picks-cats" data-favoris${state.query ? ' hidden' : ''}>${categoryButtons(favs, state.categoryId)}
        ${state.showAll ? '' : '<button type="button" class="pick" data-autre aria-expanded="false">Autre…</button>'}</div>
      ${state.showAll ? `<div data-autres${state.query ? ' hidden' : ''}><h3 class="group-title">${type === 'depense' ? 'Autres dépenses' : 'Autres rentrées'}</h3>
        <div class="picks picks-cats">${categoryButtons(others(type), state.categoryId)}</div>
        <h3 class="group-title">${type === 'depense' ? 'Rentrées' : 'Dépenses'}</h3>
        <div class="picks picks-cats">${categoryButtons(others(type === 'depense' ? 'recette' : 'depense'), state.categoryId)}</div></div>` : ''}

      <label class="choice choice-check remember">
        <input type="checkbox" data-remember${state.remember ? ' checked' : ''}>
        <span>Toujours classer <strong>${esc(name)}</strong> comme ça${same > 1
          ? `<br><span class="row-sub">Les ${same - 1} autre${same > 2 ? 's' : ''} opération${same > 2 ? 's' : ''} de ce commerce en attente ${same > 2 ? 'seront classées' : 'sera classée'} aussi.</span>` : ''}</span>
      </label>
      <p class="form-error" role="alert" tabindex="-1" hidden></p>
      <div class="sort-buttons">
        <button type="button" class="btn btn-secondary" data-passer>Passer</button>
        <button type="button" class="btn btn-primary btn-validate" data-valider>Valider</button>
      </div>
    </section>`;
}

function searchButtons(data, query) {
  const found = searchCategories(data.categories, query);
  return found.length ? categoryButtons(found, state.categoryId)
    : '<p class="note">Aucune catégorie ne correspond. Essayez un autre mot, ou ajoutez-la dans Réglages.</p>';
}

/** Liste de gauche (iPad) : l'opération en cours et les suivantes, au plus LIST_MAX. */
function listPane(data, current) {
  const i = Math.max(0, data.pending.indexOf(current));
  const shown = data.pending.slice(i, i + LIST_MAX);
  const rest = data.pending.length - shown.length;
  return `<section class="card list sort-list" aria-label="Opérations à trier">
    ${shown.map((t) => `<button type="button" class="sort-item" data-select="${esc(t.id)}" aria-pressed="${t.id === current.id}">
        <span class="row-text"><span class="row-title">${esc(displayName(t.description))}</span>
        <span class="row-sub">${esc(formatDateLong(t.date))}${(data.counts.get(t.merchantKey) ?? 1) > 1 ? ` · ${data.counts.get(t.merchantKey)} fois` : ''}</span></span>
        <span class="sort-item-amount">${formatAmount(t.amount)}</span>
      </button>`).join('')}
    ${rest > 0 ? `<p class="note pad">et ${rest} autre${rest > 1 ? 's' : ''}…</p>` : ''}
  </section>`;
}

function orderSwitch() {
  const b = (mode, label) => `<button type="button" class="pick" data-ordre="${mode}" aria-pressed="${state.order === mode}">${label}</button>`;
  return `<div class="order-switch" role="group" aria-label="Ordre des opérations">
    ${b('frequent', 'Commerces fréquents d’abord')}${b('date', 'Par date')}</div>`;
}

/** Écran « À trier ». */
export function trierView() {
  return {
    title: 'À trier',
    parent: null,
    async render(root) {
      const db = await getDb();
      const data = await load(db);
      const head = (sub) => `<div class="page-head"><div><h1>À trier</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div></div>`;
      let message = state.message ? `<p class="flash" role="status">${esc(state.message)}</p>` : '';
      state.message = '';

      if (!data.pending.length) {
        state.currentId = null;
        root.innerHTML = `${head('')}${message}
          <section class="card empty"><span class="empty-icon">${icon('trier')}</span>
            <h2>Tout est trié</h2>
            <p>Bravo ! Quand vous importerez un nouveau relevé, les opérations à classer apparaîtront ici.</p></section>
          <a class="btn btn-primary btn-wide btn-import" href="#/importer">${icon('importer')}Importer un relevé</a>`;
        return;
      }

      const paint = () => {
        let tx = data.pending.find((t) => t.id === state.currentId);
        if (!tx) {
          tx = data.pending[0];
          state.currentId = tx.id;
          resetChoice();
        }
        // Achat par carte : la titulaire de la carte est proposée d'avance.
        if (state.personId === null) state.personId = data.accounts.get(tx.accountId)?.personId ?? null;
        root.innerHTML = `${head(`${data.pending.length} opération${data.pending.length > 1 ? 's' : ''} à classer`)}${message}
          ${data.pending.length > 1 ? orderSwitch() : ''}
          <div class="sort-layout">${listPane(data, tx)}${detail(tx, data)}</div>`;
        for (const el of root.querySelectorAll('[data-color]')) el.style.setProperty('--c', el.dataset.color);
        message = ''; // le message « C’est noté » ne s’affiche qu’une fois
        bindSearch();
        return tx;
      };

      // Recherche : les résultats changent à chaque lettre, sans redessiner l'écran (le clavier reste ouvert).
      const bindSearch = () => {
        const input = root.querySelector('[data-chercher]');
        input?.addEventListener('input', () => {
          state.query = input.value;
          const res = root.querySelector('[data-resultats]');
          const fav = root.querySelector('[data-favoris]');
          const more = root.querySelectorAll('[data-autres]');
          const on = Boolean(input.value.trim());
          res.hidden = !on;
          fav.hidden = on;
          more.forEach((m) => { m.hidden = on; });
          res.innerHTML = on ? searchButtons(data, input.value) : '';
        });
        root.querySelector('[data-remember]')?.addEventListener('change', (e) => { state.remember = e.target.checked; });
      };

      let tx = paint();
      const redraw = () => { tx = paint(); };

      // Un seul gestionnaire par écran (remplacé à chaque affichage ; main.js le retire en quittant).
      root.onclick = async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.person) { state.personId = b.dataset.person; redraw(); }
        else if (b.dataset.category) {
          state.categoryId = b.dataset.category;
          state.query = '';
          redraw();
          root.querySelector('[data-valider]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else if ('autre' in b.dataset) { state.showAll = true; redraw(); root.querySelector('.group-title')?.scrollIntoView({ block: 'nearest' }); }
        else if (b.dataset.ordre) { state.order = b.dataset.ordre; state.currentId = null; this.render(root); }
        else if (b.dataset.select) { state.currentId = b.dataset.select; resetChoice(); redraw(); }
        else if ('passer' in b.dataset) {
          const i = data.pending.indexOf(tx);
          state.currentId = data.pending[(i + 1) % data.pending.length].id;
          resetChoice();
          redraw();
          window.scrollTo(0, 0);
        } else if ('valider' in b.dataset) {
          const err = root.querySelector('.form-error');
          try {
            const i = data.pending.indexOf(tx);
            const res = await classify(db, tx.id, { personId: state.personId, categoryId: state.categoryId, remember: state.remember });
            const next = data.pending.slice(i + 1).concat(data.pending.slice(0, i))
              .find((t) => t.id !== tx.id && !(res.rule && t.merchantKey === tx.merchantKey));
            state.currentId = next?.id ?? null;
            resetChoice();
            state.message = res.alsoClassified
              ? `C’est noté. ${res.alsoClassified} autre${res.alsoClassified > 1 ? 's opérations' : ' opération'} du même commerce ${res.alsoClassified > 1 ? 'ont' : 'a'} été classée${res.alsoClassified > 1 ? 's' : ''} aussi.`
              : 'C’est noté.';
            document.dispatchEvent(new CustomEvent('donnees-modifiees'));
            await this.render(root);
            window.scrollTo(0, 0);
          } catch (ex) {
            err.textContent = ex instanceof ReglageError ? ex.message : 'Cela n’a pas marché. Réessayez.';
            err.hidden = false;
            err.focus();
          }
        }
      };
    },
  };
}
