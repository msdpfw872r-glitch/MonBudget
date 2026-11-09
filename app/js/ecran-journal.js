/**
 * ecran-journal.js — Écran « Journal » : les opérations d'un mois, filtrées par personne.
 *
 * Version : 0.5.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * iPad : tableau (date, opération, pour qui, catégorie, montant) ; iPhone : liste par jour.
 * Toucher une opération ouvre « Modifier l'opération ».
 *
 * Historique :
 *   0.5.0  FRE (Fidag)  Première version.
 */

import { icon, esc } from './ui.js';
import { getDb } from './store.js';
import { formatAmount, formatCHF, formatDateLong, displayName } from '../src/core/format.js';
import { listPeople, listCategories } from '../src/core/reglages.js';
import { journal, monthSummary } from '../src/core/journal.js';
import { lastUsedByCategory, lastUsedBy } from '../src/core/tri.js';
import { currentMonth, setMonth, currentPerson, setPerson, monthSwitch, personFilter, paint } from './mois.js';
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
      <span class="op-name">${esc(displayName(t.description))}</span>
      <span class="op-who">${toSort ? '<span class="tag tag-alert">À trier</span>'
        : p ? `<span class="tag" data-color="${esc(p.color)}">${esc(p.name)}</span>` : ''}</span>
      <span class="op-cat">${toSort ? '' : esc(c?.name ?? 'Catégorie supprimée')}${notCounted ? '<span class="op-note">pas compté dans les totaux</span>' : ''}</span>
      <span class="op-amount${t.amount > 0 ? ' positive' : ''}">${formatAmount(t.amount)}</span>
    </button>`;
}

export function journalView() {
  return {
    title: 'Journal',
    parent: null,
    async render(root) {
      const db = await getDb();
      const data = await loadAll(db);
      const draw = () => {
        const month = currentMonth(data.transactions);
        const personId = currentPerson();
        const list = journal(data.transactions, { month, personId });
        const s = monthSummary(data.transactions, data.categories, { month, personId });
        root.innerHTML = `<div class="page-head"><div><h1>Journal</h1></div></div>
          ${monthSwitch(month)}
          ${personFilter(data.people, personId)}
          <p class="journal-total">${list.length} opération${list.length > 1 ? 's' : ''}
            · Rentrées <strong>${formatCHF(s.income)}</strong> · Dépenses <strong>${formatCHF(s.expenses)}</strong></p>
          ${list.length ? `<section class="card list op-table" aria-label="Opérations du mois">
              <div class="op-head" aria-hidden="true"><span>Date</span><span>Opération</span><span>Pour qui</span><span>Catégorie</span><span>Montant</span></div>
              ${list.map((t) => opRow(t, data)).join('')}
            </section>`
            : `<section class="card empty"><span class="empty-icon">${icon('journal')}</span>
                <h2>Aucune opération ce mois-ci</h2>
                <p>Changez de mois avec les boutons ci-dessus${personId ? ', ou choisissez « Tout le monde »' : ''}.</p></section>`}`;
        paint(root);
      };
      draw();
      root.onclick = async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.mois) { setMonth(b.dataset.mois); draw(); }
        else if ('filtrePersonne' in b.dataset) { setPerson(b.dataset.filtrePersonne); draw(); }
        else if (b.dataset.operation) {
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
