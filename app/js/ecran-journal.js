/**
 * ecran-journal.js — Écran « Journal » : les opérations d'un mois, filtrées par personne.
 *
 * Version : 0.16.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * iPad : tableau (date, opération, pour qui, catégorie, montant) ; iPhone : liste par jour.
 * Toucher une opération ouvre « Modifier l'opération ».
 *
 * Historique :
 *   0.5.0  FRE (Fidag)  Première version.
 *   0.5.1  FRE (Fidag)  Période semaine / mois / année / tout / dates ; loupe « Chercher une opération » ;
 *                       export des opérations affichées.
 *   0.16.0 FRE (Fidag)  Filtres compacts (période, Pour qui, Afficher : triées / à trier, Catégorie, Ordre) dans
 *                       une barre ; « Effacer les filtres » ; ordres par date, montant, nom, catégorie.
 */

import { icon, esc } from './ui.js';
import { getDb } from './store.js';
import { formatAmount, formatCHF, formatDateLong, displayName, opName } from '../src/core/format.js';
import { listPeople, listCategories } from '../src/core/reglages.js';
import { journal, monthSummary, searchOperations, exportMonth, filterOperations, sortOperations, STATUS_FILTERS, SORT_ORDERS } from '../src/core/journal.js';
import { lastUsedByCategory, lastUsedBy } from '../src/core/tri.js';
import { currentPeriod, currentPerson, setPerson, periodControls, handlePeriodClick, handleDateChange, personFilter, pickPerson, filterChip, paint } from './mois.js';
import { chooseOption, choose } from './choix.js';
import { shareOrDownload } from './partage.js';
import { editOperation } from './operation.js';

/** Charge ce qu'il faut pour le Journal, le Résumé et l'Accueil. */
export async function loadAll(db) {
  const [transactions, people, categories, accounts, rules] = await Promise.all([
    db.getAll('transactions'), listPeople(db), listCategories(db), db.getAll('accounts'), db.getAll('rules'),
  ]);
  return {
    transactions,
    people,
    categories,
    activeCategories: categories.filter((c) => !c.archived),
    categoriesById: new Map(categories.map((c) => [c.id, c])),
    peopleById: new Map(people.map((p) => [p.id, p])),
    accounts: new Map(accounts.map((a) => [a.id, a])),
    lastUsed: lastUsedByCategory(transactions, rules),
    lastUsedPerson: lastUsedBy(transactions, rules, 'personId'),
  };
}

/** Ligne d'opération (tableau sur iPad, carte sur iPhone). */
export function opRow(t, data) {
  const p = data.peopleById.get(t.personId);
  const c = data.categoriesById.get(t.categoryId);
  const toSort = t.status !== 'classee';
  const notCounted = !toSort && (t.isCardBillPayment || c?.excludeFromTotals);
  return `<button type="button" class="op-row${toSort ? ' op-to-sort' : ''}" data-operation="${esc(t.id)}">
      <span class="op-date">${esc(formatDateLong(t.date))}</span>
      <span class="op-name">${esc(opName(t))}</span>
      <span class="op-who">${toSort ? '<span class="tag tag-alert">À trier</span>'
        : p ? `<span class="tag" data-color="${esc(p.color)}">${esc(p.name)}</span>` : ''}</span>
      <span class="op-cat">${toSort ? '' : esc(c?.name ?? 'Catégorie supprimée')}${notCounted ? '<span class="op-note">pas compté dans les totaux</span>' : ''}</span>
      <span class="op-amount${t.amount > 0 ? ' positive' : ''}">${formatAmount(t.amount)}</span>
    </button>`;
}

// Texte cherché et filtres (gardés tant que l'app est ouverte ; l'ordre est retenu sur l'appareil).
let query = '';
const ORDER_KEY = 'mon-budget.ordre-journal';
const filters = { status: 'tout', categoryId: null, order: (() => {
  try { const v = localStorage.getItem(ORDER_KEY); return SORT_ORDERS.some((o) => o.id === v) ? v : 'date-desc'; } catch { return 'date-desc'; }
})() };
const filtersActive = () => Boolean(currentPerson() || filters.status !== 'tout' || filters.categoryId);

export function journalView() {
  return {
    title: 'Journal',
    parent: null,
    async render(root) {
      const db = await getDb();
      const data = await loadAll(db);
      const ctx = { categoriesById: data.categoriesById, peopleById: data.peopleById, accountsById: data.accounts,
        nameOf: (t) => opName(t) };
      const current = () => {
        const p = currentPeriod(data.transactions);
        const personId = currentPerson();
        const found = searchOperations(journal(data.transactions, { from: p.from, to: p.to, personId }), query, ctx);
        const list = sortOperations(filterOperations(found, filters), filters.order, ctx);
        return { p, personId, list };
      };

      // Résultats : redessinés à chaque lettre sans toucher au champ de recherche (le clavier reste ouvert).
      const drawResults = () => {
        const { personId, list } = current();
        const s = monthSummary(list, data.categories, {});
        root.querySelector('[data-resultats]').innerHTML = `
          <p class="journal-total">${list.length} opération${list.length > 1 ? 's' : ''}${query.trim() ? ' trouvée' + (list.length > 1 ? 's' : '') : ''}
            · Rentrées <strong>${formatCHF(s.income)}</strong> · Dépenses <strong>${formatCHF(s.expenses)}</strong></p>
          ${list.length ? `<section class="card list op-table" aria-label="Opérations">
              <div class="op-head" aria-hidden="true"><span>Date</span><span>Opération</span><span>Pour qui</span><span>Catégorie</span><span>Montant</span></div>
              ${list.slice(0, 500).map((t) => opRow(t, data)).join('')}
              ${list.length > 500 ? `<p class="note pad">Et ${list.length - 500} autres : précisez la recherche ou choisissez une période plus courte.</p>` : ''}
            </section>`
            : `<section class="card empty"><span class="empty-icon">${icon(query.trim() ? 'loupe' : 'journal')}</span>
                <h2>${query.trim() ? 'Aucune opération trouvée' : 'Aucune opération sur cette période'}</h2>
                <p>${query.trim() ? `Rien ne correspond à « ${esc(query.trim())} » sur cette période. Choisissez « Tout » pour chercher partout.`
                  : `Changez de période${filtersActive() ? ', ou touchez « Effacer les filtres »' : ''}.`}</p></section>`}`;
        paint(root);
      };

      const draw = () => {
        const { p, personId } = current();
        const status = STATUS_FILTERS.find((s) => s.id === filters.status);
        const cat = data.categoriesById.get(filters.categoryId);
        const order = SORT_ORDERS.find((o) => o.id === filters.order);
        root.innerHTML = `<div class="page-head"><div><h1>Journal</h1></div>
            <button type="button" class="btn btn-secondary" data-exporter>${icon('exporter')}Exporter</button></div>
          <div class="filter-bar">
            ${periodControls(p)}
            <div class="fchips">
              ${personFilter(data.people, personId)}
              ${filterChip({ attr: 'data-choisir-etat', label: 'Afficher', value: { tout: 'Toutes', classee: 'Triées', 'a-trier': 'À trier' }[status.id], active: status.id !== 'tout' })}
              ${filterChip({ attr: 'data-choisir-categorie', label: 'Catégorie', value: cat ? cat.name : 'Toutes', active: Boolean(cat) })}
              ${filterChip({ attr: 'data-choisir-ordre', label: 'Ordre', value: order.short, active: false })}
            </div>
            <div class="filter-search">
              <label class="search journal-search">
                ${icon('loupe')}<span class="visually-hidden">Chercher une opération</span>
                <input type="search" data-chercher value="${esc(query)}" placeholder="Chercher une opération" autocomplete="off" enterkeyhint="search">
              </label>
              ${filtersActive() ? '<button type="button" class="btn btn-secondary btn-small" data-effacer-filtres>Effacer les filtres</button>' : ''}
            </div>
          </div>
          <div class="stack" data-resultats></div>`;
        drawResults();
        const input = root.querySelector('[data-chercher]');
        input.addEventListener('input', () => { query = input.value; drawResults(); });
        for (const d of root.querySelectorAll('[data-date]')) {
          d.addEventListener('change', () => { if (handleDateChange(d, data.transactions)) draw(); });
        }
      };
      draw();

      root.onclick = async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (await handlePeriodClick(b, data.transactions)) draw();
        else if ('choisirPersonne' in b.dataset) { if (await pickPerson(data.people)) draw(); }
        else if ('choisirEtat' in b.dataset) {
          const id = await chooseOption({ title: 'Afficher', selected: filters.status, options: STATUS_FILTERS.map((s) => ({ id: s.id, name: s.label })) });
          if (id && id !== filters.status) { filters.status = id; draw(); }
        } else if ('choisirCategorie' in b.dataset) {
          const ALL = '__toutes';
          const id = await choose({
            title: 'Quelle catégorie ?', searchLabel: 'Chercher une catégorie', orderKey: 'mon-budget.ordre-categories',
            items: [{ id: ALL, name: 'Toutes les catégories' }, ...data.categories], lastUsed: data.lastUsed,
            groups: [{ title: '', filter: (c) => c.id === ALL }, { title: 'Dépenses', filter: (c) => c.type === 'depense' },
              { title: 'Rentrées', filter: (c) => c.type === 'recette' }],
            selected: filters.categoryId ?? ALL, emptyText: 'Aucune catégorie ne correspond. Essayez un autre mot.',
          });
          if (id) { filters.categoryId = id === ALL ? null : id; draw(); }
        } else if ('choisirOrdre' in b.dataset) {
          const id = await chooseOption({ title: 'Dans quel ordre ?', selected: filters.order, options: SORT_ORDERS.map((o) => ({ id: o.id, name: o.label })) });
          if (id && id !== filters.order) {
            filters.order = id;
            try { localStorage.setItem(ORDER_KEY, id); } catch { /* sans gravité */ }
            draw();
          }
        } else if ('effacerFiltres' in b.dataset) {
          setPerson(null); filters.status = 'tout'; filters.categoryId = null; query = '';
          draw();
        }
        else if ('exporter' in b.dataset) {
          const { p, personId, list } = current();
          const text = exportMonth(data.transactions, { list, categories: data.categories, people: data.people, accounts: [...data.accounts.values()] });
          const who = personId ? `_${data.peopleById.get(personId)?.name ?? ''}` : '';
          await shareOrDownload(text, `MonBudget_journal_${p.from}_${p.to}${who}.csv`);
        } else if (b.dataset.operation) {
          const tx = data.transactions.find((t) => t.id === b.dataset.operation);
          if (!tx) return;
          const changed = await editOperation(db, tx, { ...data, categories: data.activeCategories });
          if (changed) {
            document.dispatchEvent(new CustomEvent('donnees-modifiees'));
            await this.render(root);
          }
        }
      };
    },
  };
}
