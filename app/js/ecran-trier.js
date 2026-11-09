/**
 * ecran-trier.js — Écran « À trier » : une opération à la fois, « Pour qui ? » puis « C'est quoi ? ».
 *
 * Version : 0.4.6
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
 *   0.4.3  FRE (Fidag)  iPad : liste et formulaire défilent séparément ; la liste garde sa position.
 *   0.4.4  FRE (Fidag)  « C'est quoi ? » : une seule étiquette qui ouvre une fenêtre de choix avec loupe
 *                       et ordre « Derniers utilisés » / « De A à Z » ; texte « L'autre opération… » au singulier.
 *   0.4.5  FRE (Fidag)  « Pour qui ? » : au-delà de 6 personnes, une étiquette qui ouvre la même fenêtre de choix.
 *   0.4.6  FRE (Fidag)  iPad : titre et ordre en haut de la colonne de gauche, formulaire tout en haut à droite.
 *                       iPhone : « Précédente » / « Suivante » et « Liste » (fenêtre avec loupe et ordre).
 */

import { icon, esc } from './ui.js';
import { getDb } from './store.js';
import { formatAmount, formatDateLong, formatDateShort, displayName } from '../src/core/format.js';
import { listPeople, listCategories, ReglageError } from '../src/core/reglages.js';
import { classify } from '../src/core/regles.js';
import { orderPending, countByMerchant, lastUsedByCategory, lastUsedBy } from '../src/core/tri.js';
import { chooseCategory, choosePerson, choose, savedOrder } from './choix.js';

/** Au-delà de ce nombre de personnes, « Pour qui ? » devient une étiquette avec fenêtre de choix. */
const PEOPLE_BUTTONS_MAX = 6;

/** Nombre d'opérations montrées dans la liste de gauche (iPad). */
const LIST_MAX = 50;

// État de l'écran (gardé entre deux affichages).
/** Ordres de la liste des opérations (retenu d'une fois à l'autre). */
const OP_ORDERS = [{ id: 'frequent', label: 'Fréquents d’abord' }, { id: 'date', label: 'Par date' }];
const OP_ORDER_KEY = 'mon-budget.ordre-operations';

const state = { currentId: null, personId: null, categoryId: null, remember: true, message: '', order: savedOrder(OP_ORDER_KEY, OP_ORDERS) };

function resetChoice() {
  state.personId = null;
  state.categoryId = null;
  state.remember = true;
}

async function load(db) {
  const [pending, people, categories, accounts, classified, rules] = await Promise.all([
    db.getAllWhere('transactions', 'status', 'a-trier'),
    listPeople(db),
    listCategories(db, { archived: false }),
    db.getAll('accounts'),
    db.getAllWhere('transactions', 'status', 'classee'),
    db.getAll('rules'),
  ]);
  const sorted = orderPending(pending, state.order);
  const counts = countByMerchant(pending);
  const usage = new Map();
  for (const t of classified) usage.set(t.categoryId, (usage.get(t.categoryId) ?? 0) + 1);
  const lastUsed = lastUsedByCategory(classified, rules);
  const lastUsedPerson = lastUsedBy(classified, rules, 'personId');
  return { pending: sorted, counts, people, categories, accounts: new Map(accounts.map((a) => [a.id, a])), usage, lastUsed, lastUsedPerson };
}

/** Étiquette « Pour qui ? » (beaucoup de personnes) : ouvre la fenêtre de choix. */
function personTag(p) {
  return `<button type="button" class="tag-choice${p ? ' chosen' : ''}" data-ouvrir-personnes aria-haspopup="dialog">
      ${p ? `<span class="swatch" data-color="${esc(p.color)}"></span><span class="tag-name">${esc(p.name)}</span><span class="tag-change">Changer</span>`
        : `${icon('loupe')}<span class="tag-name">Choisir une personne…</span>`}
    </button>`;
}

function personButtons(people, selected) {
  return people.map((p) => `<button type="button" class="pick pick-person" data-color="${esc(p.color)}"
      data-person="${esc(p.id)}" aria-pressed="${p.id === selected}">${esc(p.name)}</button>`).join('');
}

function detail(tx, data) {
  const acc = data.accounts.get(tx.accountId);
  const type = tx.amount < 0 ? 'depense' : 'recette';
  const name = displayName(tx.description);
  const chosen = data.categories.find((c) => c.id === state.categoryId);
  const position = data.pending.indexOf(tx) + 1;
  const same = data.counts.get(tx.merchantKey) ?? 1;
  return `<section class="card sort-card" aria-labelledby="op-nom">
      ${data.pending.length > 1 ? `<div class="narrow-nav">
        <div class="narrow-nav-top">
          <p class="progress-text">Opération ${position} sur ${data.pending.length}</p>
          <button type="button" class="btn btn-secondary btn-small" data-liste aria-haspopup="dialog">${icon('journal')}Liste</button>
        </div>
        <div class="narrow-nav-arrows">
          <button type="button" class="btn btn-secondary" data-precedente>${icon('retour')}Précédente</button>
          <button type="button" class="btn btn-secondary" data-suivante>Suivante${icon('suite')}</button>
        </div>
      </div>` : ''}
      <div class="sort-head">
        <div class="row-text">
          <span class="row-sub">${esc(formatDateLong(tx.date, { capital: true }))} · ${esc(acc?.name ?? 'Compte inconnu')}</span>
          <span class="sort-name" id="op-nom">${esc(name)}</span>
        </div>
        <span class="sort-amount ${tx.amount < 0 ? '' : 'positive'}">${formatAmount(tx.amount)}</span>
      </div>
      <p class="row-sub">Texte de la banque : ${esc(tx.description)}${tx.bankCategory ? `<br>Classement de la banque : ${esc(tx.bankCategory)}` : ''}</p>

      <h2>Pour qui ?</h2>
      ${data.people.length > PEOPLE_BUTTONS_MAX ? personTag(data.people.find((p) => p.id === state.personId))
        : `<div class="picks picks-people">${personButtons(data.people, state.personId)}</div>`}

      <h2>C’est quoi ?</h2>
      <button type="button" class="tag-choice${chosen ? ' chosen' : ''}" data-ouvrir-categories aria-haspopup="dialog">
        ${chosen ? `${icon('ok')}<span class="tag-name">${esc(chosen.name)}</span><span class="tag-change">Changer</span>`
          : `${icon('loupe')}<span class="tag-name">Choisir une catégorie…</span>`}
      </button>

      <label class="choice choice-check remember">
        <input type="checkbox" data-remember${state.remember ? ' checked' : ''}>
        <span>Toujours classer <strong>${esc(name)}</strong> comme ça${same > 1
          ? `<br><span class="row-sub">${same > 2 ? `Les ${same - 1} autres opérations de ce commerce en attente seront classées aussi.` : 'L’autre opération de ce commerce en attente sera classée aussi.'}</span>` : ''}</span>
      </label>
      <p class="form-error" role="alert" tabindex="-1" hidden></p>
      <div class="sort-buttons">
        <button type="button" class="btn btn-secondary" data-passer>Passer</button>
        <button type="button" class="btn btn-primary btn-validate" data-valider>Valider</button>
      </div>
    </section>`;
}

/** Liste de gauche (iPad) : l'opération en cours et les suivantes, au plus LIST_MAX. */
function listPane(data, current) {
  const i = Math.max(0, data.pending.indexOf(current));
  const shown = data.pending.slice(i, i + LIST_MAX);
  const rest = data.pending.length - shown.length;
  return `<section class="card list sort-list" aria-label="Opérations à trier">
    ${shown.map((t) => `<button type="button" class="sort-item" data-select="${esc(t.id)}" aria-pressed="${t.id === current.id}">
        <span class="row-text"><span class="row-title">${esc(displayName(t.description))}</span>
        <span class="row-sub">${esc(formatDateShort(t.date))}${(data.counts.get(t.merchantKey) ?? 1) > 1 ? ` · ${data.counts.get(t.merchantKey)} fois` : ''}</span></span>
        <span class="sort-item-amount">${formatAmount(t.amount)}</span>
      </button>`).join('')}
    ${rest > 0 ? `<p class="note pad">et ${rest} autre${rest > 1 ? 's' : ''}…</p>` : ''}
  </section>`;
}

function orderSwitch() {
  const b = (o) => `<button type="button" class="pick" data-ordre="${o.id}" aria-pressed="${state.order === o.id}">${o.label}</button>`;
  return `<div class="order-switch side-order" role="group" aria-label="Ordre des opérations">${OP_ORDERS.map(b).join('')}</div>`;
}

/** Fenêtre « Liste des opérations » (iPhone) : loupe, ordre, toucher une ligne pour l'ouvrir. */
function openList(data, current) {
  const items = data.pending.map((t) => ({
    id: t.id,
    name: displayName(t.description),
    sub: `${formatDateShort(t.date)}${(data.counts.get(t.merchantKey) ?? 1) > 1 ? ` · ${data.counts.get(t.merchantKey)} fois` : ''}`,
    aside: formatAmount(t.amount),
    tx: t,
  }));
  const byId = new Map(items.map((i) => [i.id, i]));
  return choose({
    title: 'Opérations à trier',
    searchLabel: 'Chercher un commerce',
    orderKey: OP_ORDER_KEY,
    orders: OP_ORDERS,
    sortItems: (xs, order) => orderPending(xs.map((x) => x.tx), order).map((t) => byId.get(t.id)),
    items,
    selected: current.id,
    emptyText: 'Aucune opération ne correspond. Essayez un autre mot.',
  });
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

      const paint = ({ keepDetailScroll = false, showCurrent = true } = {}) => {
        const listTop = root.querySelector('.sort-list')?.scrollTop ?? 0;
        const detailTop = root.querySelector('.sort-card')?.scrollTop ?? 0;
        let tx = data.pending.find((t) => t.id === state.currentId);
        if (!tx) {
          tx = data.pending[0];
          state.currentId = tx.id;
          resetChoice();
        }
        // Achat par carte : la titulaire de la carte est proposée d'avance.
        if (state.personId === null) state.personId = data.accounts.get(tx.accountId)?.personId ?? null;
        // Colonne de gauche (iPad) : titre, ordre, liste. Le formulaire commence tout en haut à droite.
        root.innerHTML = `<div class="sort-layout">
            <div class="sort-side">
              ${head(`${data.pending.length} opération${data.pending.length > 1 ? 's' : ''} à classer`)}${message}
              ${data.pending.length > 1 ? orderSwitch() : ''}
              ${listPane(data, tx)}
            </div>
            ${detail(tx, data)}
          </div>`;
        for (const el of root.querySelectorAll('[data-color]')) el.style.setProperty('--c', el.dataset.color);
        message = ''; // le message « C’est noté » ne s’affiche qu’une fois
        bindSearch();
        // La liste reste où elle était ; l'opération choisie reste visible.
        const list = root.querySelector('.sort-list');
        if (list) {
          list.scrollTop = listTop;
          const cur = list.querySelector('[aria-pressed="true"]');
          if (showCurrent && cur && (cur.offsetTop < list.scrollTop || cur.offsetTop + cur.offsetHeight > list.scrollTop + list.clientHeight)) {
            list.scrollTop = cur.offsetTop - 8;
          }
        }
        if (keepDetailScroll) { const card = root.querySelector('.sort-card'); if (card) card.scrollTop = detailTop; }
        return tx;
      };

      const bindSearch = () => {
        root.querySelector('[data-remember]')?.addEventListener('change', (e) => { state.remember = e.target.checked; });
      };

      let tx = paint();
      // Choix dans le formulaire : on reste au même endroit du formulaire.
      const redraw = () => { tx = paint({ keepDetailScroll: true, showCurrent: false }); };
      // Autre opération : formulaire remis en haut.
      const goTo = () => { tx = paint(); };

      // Un seul gestionnaire par écran (remplacé à chaque affichage ; main.js le retire en quittant).
      root.onclick = async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.person) { state.personId = b.dataset.person; redraw(); }
        else if ('ouvrirPersonnes' in b.dataset) {
          const id = await choosePerson({ people: data.people, lastUsed: data.lastUsedPerson, selected: state.personId });
          if (id) { state.personId = id; redraw(); }
          root.querySelector('[data-ouvrir-personnes]')?.focus({ preventScroll: true });
        } else if ('ouvrirCategories' in b.dataset) {
          const id = await chooseCategory({ categories: data.categories, lastUsed: data.lastUsed,
            type: tx.amount < 0 ? 'depense' : 'recette', selected: state.categoryId });
          if (id) {
            state.categoryId = id;
            redraw();
            root.querySelector('[data-valider]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          root.querySelector('[data-ouvrir-categories]')?.focus({ preventScroll: true });
        } else if (b.dataset.ordre) {
          state.order = b.dataset.ordre;
          try { localStorage.setItem(OP_ORDER_KEY, state.order); } catch { /* sans gravité */ }
          state.currentId = null;
          this.render(root);
        } else if ('liste' in b.dataset) {
          const id = await openList(data, tx);
          const order = savedOrder(OP_ORDER_KEY, OP_ORDERS);
          if (id && id !== tx.id) { state.currentId = id; resetChoice(); }
          if (order !== state.order) { state.order = order; await this.render(root); }
          else if (id && id !== tx.id) goTo();
          window.scrollTo(0, 0);
        } else if ('precedente' in b.dataset || 'suivante' in b.dataset) {
          const i = data.pending.indexOf(tx);
          const step = 'suivante' in b.dataset ? 1 : -1;
          state.currentId = data.pending[(i + step + data.pending.length) % data.pending.length].id;
          resetChoice();
          goTo();
          window.scrollTo(0, 0);
        } else if (b.dataset.select) { state.currentId = b.dataset.select; resetChoice(); goTo(); }
        else if ('passer' in b.dataset) {
          const i = data.pending.indexOf(tx);
          state.currentId = data.pending[(i + 1) % data.pending.length].id;
          resetChoice();
          goTo();
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
