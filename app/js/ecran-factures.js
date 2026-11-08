/**
 * ecran-factures.js — Écran « Factures de carte » : rattacher les achats des cartes au prélèvement
 * de la facture (LSV) sur le compte, pour ne pas les compter deux fois.
 *
 * Version : 0.4.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Adresses : #/factures (liste), #/factures/<id> (cocher les achats d'une facture).
 *
 * Historique :
 *   0.4.0  FRE (Fidag)  Première version.
 */

import { icon, esc } from './ui.js';
import { getDb } from './store.js';
import { formatCHF, formatAmount, formatDateLong, displayName } from '../src/core/format.js';
import { ReglageError } from '../src/core/reglages.js';
import { listBills, billStatus, candidates, linkBill, cardsPaidFrom } from '../src/core/cartes.js';
import { toCents } from '../src/core/text.js';

function statusText(st) {
  if (st.complete) return `Juste : ${st.count} achat${st.count > 1 ? 's' : ''} rattaché${st.count > 1 ? 's' : ''}`;
  if (!st.count) return 'À vérifier : aucun achat rattaché';
  return `À vérifier : écart de ${formatCHF(Math.abs(st.difference))}`;
}

function liste() {
  return {
    title: 'Factures de carte',
    parent: null,
    async render(root) {
      const db = await getDb();
      const bills = await listBills(db);
      const accounts = new Map((await db.getAll('accounts')).map((a) => [a.id, a]));
      const rows = [];
      for (const b of bills) {
        const st = await billStatus(db, b);
        rows.push(`<a class="row" href="#/factures/${encodeURIComponent(b.id)}">
          <span class="row-text"><span class="row-title">${esc(formatDateLong(b.date, { capital: true }))} · ${formatCHF(Math.abs(b.amount))}</span>
          <span class="row-sub ${st.complete ? '' : 'warn'}">${st.complete ? '' : icon('attention')}${esc(statusText(st))} · ${esc(accounts.get(b.accountId)?.name ?? '')}</span></span>
          ${icon('suite')}</a>`);
      }
      root.innerHTML = `<p class="note">Le prélèvement de la facture de carte n’est pas compté dans les totaux :
          ce sont les achats faits avec les cartes qui le sont, chacun pour sa personne.
          Ici, vous vérifiez que les achats correspondent bien à chaque facture.</p>
        ${rows.length ? `<section class="card list">${rows.join('')}</section>`
          : `<section class="card empty"><span class="empty-icon">${icon('carte')}</span><h2>Aucune facture pour l’instant</h2>
             <p>Le prélèvement de la facture de carte sera reconnu en important le relevé du compte.</p></section>`}`;
    },
  };
}

function facture(id) {
  let checked = null; // Set des achats cochés (gardé pendant qu'on coche)
  return {
    title: 'Facture de carte',
    parent: '#/factures',
    async render(root) {
      const db = await getDb();
      const bill = await db.get('transactions', id);
      if (!bill?.isCardBillPayment) { location.hash = '#/factures'; return; }
      const list = await candidates(db, bill);
      const cards = await cardsPaidFrom(db, bill.accountId);
      const people = new Map((await db.getAll('people')).map((p) => [p.id, p]));
      if (!checked) checked = new Set(list.filter((t) => t.cardBillId === bill.id).map((t) => t.id));

      const sum = list.filter((t) => checked.has(t.id)).reduce((s, t) => s + toCents(t.amount), 0);
      const diff = toCents(bill.amount) - sum;
      const diffText = diff === 0
        ? `<p class="flash">${icon('ok')}Le total des achats cochés est exactement celui de la facture.</p>`
        : `<p class="warn-box">${icon('attention')}${diff < 0 ? 'Il manque' : 'Il y a trop de'} ${formatCHF(Math.abs(diff) / 100)} par rapport à la facture.
           ${diff < 0 ? 'Il peut s’agir de frais de la carte ou d’achats pas encore importés.' : 'Décochez les achats qui appartiennent à la facture suivante.'}</p>`;

      const group = (card) => {
        const items = list.filter((t) => t.accountId === card.id);
        if (!items.length) return '';
        const owner = people.get(card.personId);
        return `<h2 class="group-title">${esc(card.name)}${owner ? ` · ${esc(owner.name)}` : ''}</h2>
          <section class="card list">
            ${items.map((t) => `<label class="row check-row">
              <input type="checkbox" data-achat="${esc(t.id)}"${checked.has(t.id) ? ' checked' : ''}>
              <span class="row-text"><span class="row-title">${esc(displayName(t.description))}</span>
                <span class="row-sub">${esc(formatDateLong(t.date))}</span></span>
              <span class="row-title">${formatAmount(t.amount)}</span>
            </label>`).join('')}
          </section>`;
      };

      root.innerHTML = `<section class="card">
          <div class="card-line"><span class="round-icon">${icon('carte')}</span>
            <span class="row-text"><span class="row-title">Prélevée le ${esc(formatDateLong(bill.date))}</span>
            <span class="row-sub">${esc(bill.description)}</span></span></div>
          <div class="counts">
            <div class="count-line"><span>Montant de la facture</span><strong>${formatCHF(Math.abs(bill.amount))}</strong></div>
            <div class="count-line"><span>Achats cochés (${checked.size})</span><strong>${formatCHF(Math.abs(sum) / 100)}</strong></div>
          </div>
          ${diffText}
        </section>
        <p class="note">Cochez les achats payés par cette facture.</p>
        ${cards.map(group).join('') || '<p class="note">Aucune carte n’est payée depuis ce compte. Réglez-le dans Réglages, « Mes comptes ».</p>'}
        <p class="form-error" role="alert" tabindex="-1" hidden></p>
        <button type="button" class="btn btn-primary btn-wide" data-enregistrer>Enregistrer</button>`;

      root.onchange = (e) => {
        const box = e.target.closest('[data-achat]');
        if (!box) return;
        if (box.checked) checked.add(box.dataset.achat); else checked.delete(box.dataset.achat);
        const y = root.closest('dialog')?.scrollTop ?? window.scrollY;
        this.render(root).then(() => {
          const d = root.closest('dialog');
          if (d) d.scrollTop = y; else window.scrollTo(0, y);
          root.querySelector(`[data-achat="${CSS.escape(box.dataset.achat)}"]`)?.focus();
        });
      };
      root.onclick = async (e) => {
        if (!e.target.closest('[data-enregistrer]')) return;
        const err = root.querySelector('.form-error');
        try {
          await linkBill(db, bill.id, [...checked]);
          document.dispatchEvent(new CustomEvent('donnees-modifiees'));
          location.hash = '#/factures';
        } catch (ex) {
          err.textContent = ex instanceof ReglageError ? ex.message : 'L’enregistrement n’a pas marché. Réessayez.';
          err.hidden = false;
          err.focus();
        }
      };
    },
  };
}

/** @param {string[]} path segments après « factures » */
export function facturesView(path) {
  const [id] = path.map(decodeURIComponent);
  return id ? facture(id) : liste();
}
