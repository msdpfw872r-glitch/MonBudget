/**
 * detail.js — Fenêtre « Détail » : toucher un montant affiche les opérations qui le composent.
 *
 * Version : 0.5.2
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Les montants cliquables portent data-detail="<genre>" (+ data-detail-id, data-from, data-to).
 * Genres : income, expenses, balance, category, person, excluded, toSort (voir journal.js).
 * Dans le détail, toucher une opération ouvre « Modifier l'opération ».
 *
 * Historique :
 *   0.5.2  FRE (Fidag)  Première version.
 */

import { esc } from './ui.js';
import { formatCHF } from '../src/core/format.js';
import { detailOperations, totalOf } from '../src/core/journal.js';
import { periodLabel } from '../src/core/periode.js';
import { opRow } from './ecran-journal.js';
import { editOperation } from './operation.js';
import { paint } from './mois.js';

const TITLES = {
  income: 'Rentrées',
  expenses: 'Dépenses',
  balance: 'Rentrées et dépenses comptées',
  excluded: 'Pas comptées dans les totaux',
  toSort: 'Pas encore triées',
};

function dialogEl() {
  let d = document.getElementById('fenetre-detail');
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'fenetre-detail';
  d.className = 'sheet picker';
  d.setAttribute('aria-labelledby', 'fenetre-detail-titre');
  document.body.append(d);
  return d;
}

/**
 * Bouton-montant qui ouvre le détail.
 * @param {string} inner  contenu affiché (HTML déjà échappé)
 * @param {{kind: string, id?: string, from: string, to: string}} what
 * @param {string} [cls]
 */
export function detailButton(inner, what, cls = '') {
  return `<button type="button" class="detail-link ${cls}" data-detail="${esc(what.kind)}"
      ${what.id ? `data-detail-id="${esc(what.id)}"` : ''} data-from="${esc(what.from)}" data-to="${esc(what.to)}"
      aria-haspopup="dialog">${inner}</button>`;
}

/**
 * Ouvre le détail correspondant à un bouton data-detail.
 * @param {HTMLElement} b
 * @param {object} db
 * @param {object} data  résultat de loadAll()
 * @param {string|null} personId  filtre « pour qui » en cours
 * @returns {Promise<boolean>} vrai si une opération a été modifiée (l'écran doit se redessiner)
 */
export async function openDetail(b, db, data, personId) {
  const what = { kind: b.dataset.detail, id: b.dataset.detailId };
  const f = { from: b.dataset.from, to: b.dataset.to, personId };
  const d = dialogEl();
  let changed = false;

  const title = () => {
    if (what.kind === 'category') return data.categoriesById.get(what.id)?.name ?? 'Catégorie';
    if (what.kind === 'person') return `Dépenses pour ${data.peopleById.get(what.id)?.name ?? '…'}`;
    return TITLES[what.kind] ?? 'Détail';
  };

  const draw = () => {
    const list = detailOperations(data.transactions, data.categories, f, what);
    const total = totalOf(list);
    const who = personId ? ` · ${data.peopleById.get(personId)?.name ?? ''}` : '';
    d.innerHTML = `<div class="sheet-head">
        <h2 id="fenetre-detail-titre">${esc(title())}</h2>
        <button type="button" class="btn btn-secondary" data-fermer>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>Fermer
        </button>
      </div>
      <div class="picker-tools">
        <p class="row-sub">${esc(periodLabel({ kind: 'libre', from: f.from, to: f.to }))}${esc(who)}</p>
        <p class="detail-total">${list.length} opération${list.length > 1 ? 's' : ''} · total <strong>${formatCHF(Math.abs(total))}</strong></p>
      </div>
      <div class="sheet-body picker-list">
        ${list.length ? `<section class="card list op-table op-compact">${list.map((t) => opRow(t, data)).join('')}</section>`
          : `<p class="note">Aucune opération.</p>`}
        <p class="note">Touchez une opération pour la modifier.</p>
      </div>`;
    paint(d);
  };

  draw();
  d.showModal();
  return new Promise((resolve) => {
    d.onclick = async (e) => {
      if (e.target === d) { d.close(); return; }
      const btn = e.target.closest('button');
      if (!btn) return;
      if ('fermer' in btn.dataset) d.close();
      else if (btn.dataset.operation) {
        const tx = data.transactions.find((t) => t.id === btn.dataset.operation);
        if (tx && await editOperation(db, tx, { ...data, categories: data.activeCategories })) {
          changed = true;
          // Une règle a pu classer d'autres opérations en même temps : on relit tout.
          data.transactions = await db.getAll('transactions');
          draw();
        }
      }
    };
    d.addEventListener('close', () => resolve(changed), { once: true });
  });
}

